import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';

test('shared provider choices use first-use defaults, remember pairs and preserve authoritative edits',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-choices-'));let inference=0;
 let app=startInstance(join(dir,'db'),0,{providerFactory:async()=>{inference++;throw Error('No inference permitted')}});let port=await app.listen();let token='';
 const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api/`+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}};
 try{
 token=(await call('pair',{code:app.code})).body.token;
 let defaults=await call('provider-defaults');assert.equal(defaults.status,200);
 assert.equal((await call('provider-defaults',{revision:defaults.body.revision,provider:'codex',model:'first',reasoning:'high'})).status,200);
 let a=(await call('bots',{name:'A'})).body;const b=(await call('bots',{name:'B'})).body;
 const choose=async(provider,model,reasoning)=>call(`bots/${a.id}/selection`,{revision:a.revision,provider,...(model===undefined?{}:{model}),...(reasoning===undefined?{}:{reasoning})});
 a=(await choose('codex')).body;assert.equal(a.model,'first');assert.equal(a.reasoning,'high');
 const stale=a; a=(await choose('codex','mine','low')).body;
 assert.equal((await call(`bots/${a.id}/selection`,{revision:stale.revision,provider:'demo'})).status,409);
 a=(await choose('openrouter')).body;assert.equal(a.model,null);assert.equal(a.reasoning,null);
 defaults=(await call('provider-defaults')).body;
 await call('provider-defaults',{revision:defaults.revision,provider:'codex',model:'later',reasoning:null});
 a=(await choose('codex')).body;assert.equal(a.model,'mine');assert.equal(a.reasoning,'low');
 assert.equal((await call('bots/'+b.id)).body.provider,'demo');
 const path=join(a.configDir,'agent.toml');let text=readFileSync(path,'utf8');assert.match(text,/providerChoices/);
 writeFileSync(path,text.replace('mine','direct'));
 a=(await call('bots/'+a.id)).body;assert.equal(a.model,'direct');
 a=(await choose('demo')).body;a=(await choose('codex')).body;assert.equal(a.model,'direct');
 writeFileSync(join(a.configDir,'agent.toml'),'invalid = [');assert.equal((await choose('demo')).status,422);
 writeFileSync(join(a.configDir,'agent.toml'),readFileSync(path,'utf8')); // old observed valid files remain usable
 assert.equal(inference,0);
 await app.close();app=startInstance(join(dir,'db'));port=await app.listen();
 assert.equal((await call('bots/'+b.id)).body.provider,'demo');
 assert.equal((await call('provider-defaults')).body.providers.codex.model,'later');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true})}
});

test('metadata handles explicit advertised defaults, unknown reasoning, empty catalogs and outages without inference',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-metadata-'));let inference=0,fail=false,requests=0;
 const app=startInstance(join(dir,'db'),0,{env:{},providerFactory:async()=>{inference++;throw Error('Inference forbidden')},modelRequest:async()=>{requests++;if(fail)throw Error('Unavailable');return new Response(JSON.stringify({default_model:'advertised',data:[{id:'advertised',reasoning:{supported_efforts:['high']}},{id:'plain',reasoning:{supported_efforts:[]}},{id:'unknown'}]}))}});const port=await app.listen();let token='';
 const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api/`+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}};
 try{token=(await call('pair',{code:app.code})).body.token;
 assert.equal((await call('models',{provider:'openrouter'})).status,200);
 let a=(await call('bots',{name:'Metadata'})).body;
 const choose=async(edit)=>{const result=await call(`bots/${a.id}/selection`,{revision:a.revision,provider:'openrouter',...edit});assert.equal(result.status,200,JSON.stringify(result.body));a=result.body;return a};
 await choose({});assert.equal(a.model,'advertised');
 await choose({reasoning:'high'});await choose({model:'plain'});assert.equal(a.reasoning,null);
 await choose({model:'advertised',reasoning:'high'});await choose({model:'unknown'});assert.equal(a.reasoning,'high','missing metadata does not prove incompatibility');
 await choose({model:'manual/not-listed'});assert.equal(a.reasoning,'high');
 fail=true;assert.equal((await call('models',{provider:'openrouter'})).status,400);assert.equal((await call('bots/'+a.id)).body.model,'manual/not-listed');
 assert.equal((await call('models',{})).status,400);assert.equal((await call('provider-defaults',{revision:'stale',provider:'openrouter',model:'no',reasoning:null})).status,409);
 assert.equal(inference,0);assert.equal(requests,2);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true})}
});

test('paired CLI and accepted responses observe one authoritative selection with captured in-flight settings',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);
 const dir=mkdtempSync(join(tmpdir(),'staf-selection-clients-'));let captured,release;
 const gate=new Promise(resolve=>{release=resolve});
 const app=startInstance(join(dir,'db'),0,{env:{},providerFactory:async profile=>{captured=profile;return {name:'synthetic',capabilities:{toolCalls:false,incrementalText:false},complete:async()=>{await gate;return {role:'assistant',content:'Synthetic completed'}}}}});const port=await app.listen();const url=`http://127.0.0.1:${port}`;let token='';
 const call=async(path,body)=>{const r=await fetch(url+'/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return r.json()};
 const cli=async(...args)=>{const output=(await run(process.execPath,['dist/cli.js','instance',args[0],url,join(dir,'client.json'),...args.slice(1)])).stdout;return args[0]==='pair'?output:JSON.parse(output)};
 const wait=async fn=>{for(let n=0;n<100;n++){if(await fn())return;await new Promise(r=>setTimeout(r,10))}throw Error('Timed out')};
 try{await cli('pair',app.code);token=(await call('pair',{code:app.issueCode()})).token;
 let a=await call('bots',{name:'Captured',provider:'openrouter',model:'before',reasoning:'high'});
 assert.equal((await call('commands',{id:'captured-command',botId:a.id,content:'Synthetic prompt'})).kind,'accepted');
 await wait(()=>captured);a=await cli('select',a.id,a.revision,'codex','after','low');
 assert.equal(a.provider,'codex');assert.equal((await call('bots/'+a.id)).model,'after');
 assert.equal(captured.provider,'openrouter');assert.equal(captured.model,'before');assert.equal(captured.reasoning,'high');
 a=await cli('select',a.id,a.revision,'openrouter');assert.equal(a.model,'before');assert.equal(a.reasoning,'high');
 release();await wait(async()=>(await call('commands/captured-command')).state==='completed');
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true})}
});
