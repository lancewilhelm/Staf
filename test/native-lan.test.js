import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {startInstance} from '../dist/instance-service.js';
import {createLanGateway} from '../deploy/native-linux/lan-gateway.mjs';

test('TLS gateway preserves pairing, origin checks, revocation and loopback access', async () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-lan-'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 const app=startInstance(join(dir,'instance.sqlite'),0,{env:{}}); const backendPort=await app.listen();
 const gateway=createLanGateway({address:'127.0.0.1',port:0,backendPort,key:readFileSync(join(dir,'key.pem')),cert:readFileSync(join(dir,'cert.pem'))});
 await new Promise((resolve,reject)=>gateway.listen(0,'127.0.0.1',resolve).once('error',reject));
 const port=gateway.address().port, origin=`https://127.0.0.1:${port}`;
 const call=(path,{method='GET',body,headers={}}={})=>new Promise((resolve,reject)=>{const req=request(origin+path,{method,ca:readFileSync(join(dir,'cert.pem')),checkServerIdentity:(_host,cert)=>checkServerIdentity('127.0.0.1',cert),headers:{...headers,...(body?{'content-type':'application/json'}:{})}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:text}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
 try {
  assert.equal((await call('/api/bots')).status,401);
  assert.equal((await call('/api/pair',{method:'POST',body:{code:app.code},headers:{origin:'https://evil.example'}})).status,403);
  assert.equal((await call('/api/dataset',{headers:{host:'evil.example'}})).status,403);
  const paired=await call('/api/pair',{method:'POST',body:{code:app.code},headers:{origin}});assert.equal(paired.status,200);const token=JSON.parse(paired.body).token;
  const headers={authorization:`Bearer ${token}`,origin};assert.equal((await call('/api/bots',{headers})).status,200);
  const clients=JSON.parse((await call('/api/clients',{headers})).body);const own=clients.find(client=>client.current);assert.ok(own);
  assert.equal((await call(`/api/clients/${own.id}/revoke`,{method:'POST',body:{},headers})).status,200);
  assert.equal((await call('/api/bots',{headers})).status,401);
  assert.equal((await fetch(`http://127.0.0.1:${backendPort}/api/dataset`)).status,200);
 } finally {await new Promise(resolve=>gateway.close(resolve));await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('stopped-data archive restores conversations, memory, schedules, settings and client authority',async()=>{
 const {mkdirSync,writeFileSync}=await import('node:fs');
 const root=mkdtempSync(join(tmpdir(),'staf-backup-')),home=join(root,'home'),restored=join(root,'restored');
 const data=join(home,'.local/share/staf/data'),config=join(home,'.config/staf');mkdirSync(data,{recursive:true});mkdirSync(config,{recursive:true});mkdirSync(restored);writeFileSync(join(config,'fixture-secret'),'synthetic connection');
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(){return {role:'assistant',content:'Controlled reply'};}});
 let app=startInstance(join(data,'instance.sqlite'),0,{env:{},providerFactory}),port=await app.listen();
 const call=async(path,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};};
 try {
  const token=(await call('/api/pair','',{code:app.code})).body.token;
  const bot=(await call('/api/bots',token,{name:'Backup fixture',provider:'live',model:'fixture-offline'})).body;
  await call('/api/memories/user',token,{text:'Backup memory'});
  const core=(await call('/api/core',token)).body;assert.equal((await call('/api/core',token,{revision:core.revision,content:'Backup core'})).status,200);
  await call('/api/commands',token,{id:'backup-chat',botId:bot.id,content:'Backup conversation'});
  const schedule=await call('/api/schedules',token,{botId:bot.id,objective:'Backup schedule',recurrence:{kind:'daily',timeZone:'UTC',hour:1,minute:0},maxLatenessMs:300000,authorization:{action:'clock.read',resource:'utc',limits:{reads:'permitted'}}});assert.equal(schedule.status,201);
  await app.close();app=undefined;
  const archive=join(root,'backup.tar.gz');execFileSync('tar',['-C',home,'-czf',archive,'.local/share/staf/data','.config/staf']);execFileSync('tar',['-xzf',archive,'-C',restored]);
  app=startInstance(join(restored,'.local/share/staf/data/instance.sqlite'),0,{env:{},providerFactory});port=await app.listen();
  const restoredBot=(await call('/api/bots',token)).body[0];assert.equal(restoredBot.name,'Backup fixture');assert.equal(restoredBot.provider,'live');assert.equal(restoredBot.model,'fixture-offline');
  assert.match(JSON.stringify((await call(`/api/bots/${bot.id}/messages`,token)).body),/Backup conversation/);
  assert.match(JSON.stringify((await call('/api/memories/user',token)).body),/Backup memory/);
  assert.equal((await call('/api/core',token)).body.content,'Backup core');
  assert.equal(readFileSync(join(restored,'.config/staf/fixture-secret'),'utf8'),'synthetic connection');
  assert.match(JSON.stringify((await call('/api/schedules',token)).body),/Backup schedule/);
 } finally {if(app)await app.close();rmSync(root,{recursive:true,force:true});}
});


test('gateway refuses wildcard, public addresses and invalid ports at startup',()=>{
 for(const [address,port] of [['0.0.0.0','3443'],['8.8.8.8','3443'],['192.168.1.1','443'],['::','3443']]) {
  const result=spawnSync(process.execPath,['deploy/native-linux/lan-gateway.mjs'],{env:{...process.env,STAF_LAN_ADDRESS:address,STAF_LAN_PORT:port,STAF_LAN_KEY:'/missing-key',STAF_LAN_CERT:'/missing-cert'},encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Set a private IPv4 address/);
 }
});
