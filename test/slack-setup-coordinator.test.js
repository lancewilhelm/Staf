import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SecretRequests} from '../dist/secret-requests.js';
import {slackSetupCapability} from '../dist/slack-setup.js';

test('Slack setup requests two protected secrets and passes only their exact revisions for confirmation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-setup-'));const secrets=new SecretRequests(dir,false);
 const signal=new AbortController().signal,work={botId:'agent',work:{kind:'command',id:'work'},signal};
 const action={id:'action',fingerprint:'fingerprint'},input={teamId:'T123',userId:'U123',channelId:'D123'};let approval,pauses=0;
 const capability=slackSetupCapability({secrets,eligible:()=>true,check:()=>{},pause:()=>pauses++,resume:()=>pauses--,confirm:async value=>{approval=value;return 'Connection pending';}});
 try {
  const result=capability.execute(input,work,action);
  let [request]=secrets.list();assert.match(request.purpose,/Socket Mode/);assert.match(request.destination,/T123.*U123.*D123/);
  secrets.decide(request.id,'saved','xapp-synthetic-app');await new Promise(resolve=>setImmediate(resolve));
  [request]=secrets.list();assert.match(request.purpose,/Slack bot/);
  secrets.add({name:'Existing bot',purpose:'Synthetic bot',value:'xoxb-synthetic-bot'});
  const saved=secrets.names().find(item=>item.name==='Existing bot');secrets.select(request.id,saved.name,saved.revision);
  assert.equal(await result,'Connection pending');assert.equal(pauses,0);
  assert.deepEqual(approval.config,{...input,botId:'agent'});assert.deepEqual(approval.bot,{name:saved.name,revision:saved.revision});
  assert.ok(!JSON.stringify(approval).includes('synthetic-app'));assert.ok(!JSON.stringify(approval).includes('synthetic-bot'));
 } finally {secrets.close();rmSync(dir,{recursive:true,force:true});}
});

test('skipping a token or replacing a selected token prevents Slack confirmation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-setup-'));const secrets=new SecretRequests(dir,false);
 const work={botId:'agent',work:{kind:'command',id:'work'},signal:new AbortController().signal},input={teamId:'T123',userId:'U123',channelId:'D123'};let confirmations=0;
 const capability=slackSetupCapability({secrets,eligible:()=>true,check:()=>{},pause:()=>{},resume:()=>{},confirm:async()=>{confirmations++;return 'connected';}});
 try {
  const skipped=capability.execute(input,work,{id:'skip',fingerprint:'skip'});secrets.decide('skip-app','skipped');
  assert.match(await skipped,/not completed/);assert.equal(confirmations,0);
  const changed=capability.execute(input,work,{id:'changed',fingerprint:'changed'});secrets.decide('changed-app','saved','xapp-synthetic-app');await new Promise(resolve=>setImmediate(resolve));
  const app=secrets.selection('changed-app');secrets.replace({...app,value:'xapp-replacement'});
  secrets.decide('changed-bot','saved','xoxb-synthetic-bot');await assert.rejects(changed,error=>/selected secret changed/i.test(error.safeResult));assert.equal(confirmations,0);
 } finally {secrets.close();rmSync(dir,{recursive:true,force:true});}
});

test('Slack confirmation requires the exact pending proposal and survives restart as interrupted',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-approval-'));let secrets=new SecretRequests(dir,false);
 const work={kind:'command',id:'work'},approval={config:{teamId:'T123',userId:'U123',channelId:'D123',botId:'agent'},app:{name:'app',revision:'11111111-1111-4111-8111-111111111111'},bot:{name:'bot',revision:'22222222-2222-4222-8222-222222222222'},authority:{agentRevision:'agent-revision',slackGeneration:0,connectionRevision:null,agentAccess:null}};
 try {
  secrets.createSlackSetup('one','agent',work,approval);const waiting=secrets.waitSlackSetup('one',new AbortController().signal);
  assert.equal(secrets.beginSlackSetup('one',{...approval,config:{...approval.config,channelId:'D456'}}),false);
  assert.equal(secrets.beginSlackSetup('one',approval),true);assert.equal(secrets.beginSlackSetup('one',approval),false);
  assert.equal(secrets.finishSlackSetup('one','completed','connecting'),true);assert.equal(await waiting,'connecting');
  secrets.createSlackSetup('two','agent',work,approval);secrets.close();secrets=new SecretRequests(dir,false);
  assert.equal(secrets.slackSetups().find(item=>item.id==='two').state,'interrupted');assert.equal(secrets.beginSlackSetup('two',approval),false);
 } finally {secrets.close();rmSync(dir,{recursive:true,force:true});}
});
