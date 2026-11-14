import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from './fixtures/controlled-instance.mjs';
import {directCodexProvider} from '../dist/codex-direct.js';
import {liveProvider,lmStudioProvider,openRouterProvider} from '../dist/providers.js';
import {codexProvider} from '../dist/codex.js';

const wait=async fn=>{for(let i=0;i<400;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Timed out');};

test('the real direct adapter fences newly known chat and instruction secrets after token preflight',async()=>{
 for(const field of ['message','instructions','model']){const marker=`synthetic-direct-${field}-secret-98144`,dir=mkdtempSync(join(tmpdir(),'staf-dispatch-fence-'));let entered,release,requests=0;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,providerFactory:async(profile,instructions)=>directCodexProvider({model:profile.model,sessionId:profile.chatId,dataDir:dir,instructions,token:async()=>{entered();await gate;return 'synthetic-bearer';},request:async()=>{requests++;throw Error('must not dispatch');}})});const port=await app.listen();let token;
  const call=async(route,body,auth=token)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(auth?{Authorization:`Bearer ${auth}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json()};};
  try{token=(await call('/api/pair',{code:app.code},'')).value.token;const bot=(await call('/api/bots',{name:'Agent',provider:'codex',model:field==='model'?marker:'synthetic-model',instructions:field==='instructions'?`Remember ${marker}`:'Normal instructions'})).value;await call('/api/commands',{id:'direct-held',botId:bot.id,content:field==='message'?`Question ${marker}`:'Normal question'});await started;assert.equal((await call('/api/secrets/add',{name:'Late secret',purpose:'Synthetic fixture',value:marker})).status,200);release();await wait(async()=>(await call('/api/commands/direct-held')).value.state==='failed');assert.equal(requests,0,'HTTP request must not start');}
  finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
 }
});

test('every built-in provider checks complete model payloads at dispatch',async()=>{
 const marker='synthetic-complete-payload-marker-4391',tools=[{type:'function',function:{name:'clock',description:marker,parameters:{type:'object',properties:{}}}}],messages=[{role:'user',content:'ordinary'}];let sends=0,checked=[];
 const request=async()=>{sends++;throw Error('must not dispatch');};
 const assertion=payload=>{checked.push(payload);if(JSON.stringify(payload).includes(marker))throw Error('blocked synthetic marker');};
 const options={refreshMessages:()=>messages,assertSafePayload:assertion};
 const providers=[liveProvider({STAF_API_KEY:'dummy',STAF_MODEL:'fixture'},request,marker),lmStudioProvider({},'fixture',request,marker),openRouterProvider({OPENROUTER_API_KEY:'dummy'},'fixture',request,undefined,marker),directCodexProvider({model:'fixture',sessionId:'synthetic',dataDir:'/unused',instructions:marker,token:async()=>'synthetic-bearer',request})];
 for(const provider of providers){const before=checked.length;await assert.rejects(provider.complete(messages,tools,options),/blocked synthetic marker/);assert.equal(checked.length,before+1);}
 const streaming=openRouterProvider({OPENROUTER_API_KEY:'dummy'},'fixture',request,undefined,marker);await assert.rejects(async()=>{for await(const event of streaming.stream(messages,tools,options))void event;},/blocked synthetic marker/);
 let cliCalls=0;const runner=async args=>{if(args[0]==='login')return 'Logged in using ChatGPT';if(args[0]==='mcp')return '[]';cliCalls++;throw Error('must not dispatch');};const cli=await codexProvider('fixture',runner);await assert.rejects(cli.complete(messages,tools,options),/blocked synthetic marker/);assert.equal(cliCalls,0);assert.equal(sends,0);
});

test('a secret recognized in protected replay fences dispatch and does not write altered replay',async()=>{
 const {runTurn}=await import('../dist/runtime.js');const marker='synthetic-encrypted-replay-81173';let known=false,entered,release,sends=0,saves=0;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const session={version:1,id:'replay-session',provider:'codex',messages:[{role:'user',content:'Prior question'},{role:'assistant',content:'Prior answer',responseReplay:{provider:'codex-direct',model:'fixture',items:[{type:'reasoning',encrypted_content:marker},{type:'message',role:'assistant',content:[{type:'output_text',text:'Prior answer'}]}]}}],events:[]};
 const provider=directCodexProvider({model:'fixture',sessionId:'replay-session',dataDir:'/unused',token:async()=>{entered();await gate;return 'synthetic-bearer';},request:async()=>{sends++;throw Error('must not dispatch');}});
 const pending=runTurn({session,provider,store:{save:async()=>{saves++;}},text:'Next question',redact:value=>known?value.split(marker).join('[REDACTED]'):value});await started;known=true;release();await assert.rejects(pending);assert.equal(sends,0);assert.equal(saves,0,'protected replay must not be rewritten or newly stored');
});

test('dispatch fencing catches newly known secrets encoded inside JSON text',async()=>{
 const {runTurn}=await import('../dist/runtime.js'),{redactor}=await import('../dist/config.js');const marker='synthetic-boundary\n"quoted-value-9173';let known=false,entered,release,sends=0;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const session={version:1,id:'escaped-session',provider:null,messages:[],events:[]};const provider=directCodexProvider({model:'fixture',sessionId:session.id,dataDir:'/unused',token:async()=>{entered();await gate;return 'synthetic-bearer';},request:async()=>{sends++;throw Error('must not dispatch');}});
 const pending=runTurn({session,provider,store:{save:async()=>{}},text:JSON.stringify({earlier:marker}),redact:value=>known?redactor({OPENROUTER_API_KEY:marker})(value):value});await started;known=true;release();await assert.rejects(pending);assert.equal(sends,0);
});


test('Codex CLI preflight fences a secret recognized before process launch',async()=>{
 const {runTurn}=await import('../dist/runtime.js');const marker='synthetic-cli-delayed-secret-49193';let known=false,entered,release,checks=0,launches=0;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const runner=async args=>{if(args[0]==='login')return 'Logged in using ChatGPT';if(args[0]==='mcp'){if(++checks===2){entered();await gate;}return '[]';}launches++;throw Error('must not launch');};
 const provider=await codexProvider('fixture',runner),session={version:1,id:'cli-session',provider:null,messages:[],events:[]};const pending=runTurn({session,provider,store:{save:async()=>{}},text:'Question '+marker,redact:value=>known?value.split(marker).join('[REDACTED]'):value});await started;known=true;release();await assert.rejects(pending);assert.equal(launches,0);
});
