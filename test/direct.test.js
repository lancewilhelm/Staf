import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir,lstat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {directCodexProvider,responsesRequest,responsesInput,responseEvents,directUsage,DIRECT_RESPONSES_URL} from '../dist/codex-direct.js';
import {authorizationUrl,completeDirectLogin,loadDirectCredential,directAccessToken,directAuth,validateIdToken} from '../dist/codex-direct-auth.js';
import {tools,runTurn} from '../dist/runtime.js';
import {Store} from '../dist/store.js';
import {liveProvider} from '../dist/providers.js';
import {validSession} from '../dist/validation.js';
const model='test-model';
const completed=(output,usage)=>({type:'response.completed',response:{status:'completed',model,output,...(usage?{usage}: {})}});
const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
function sse(events,fragment=1){const bytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''));let position=0;return new Response(new ReadableStream({pull(controller){if(position>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(position,position+fragment));position+=fragment;}}),{headers:{'Content-Type':'text/event-stream'}});}
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'staf-direct-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
const provider=request=>directCodexProvider({model,sessionId:'session-a',dataDir:'/unused',token:async()=> 'dummy-access',request});

test('direct request has scoped stable cache identity, real item boundaries and provider/model-bound reasoning replay',()=>{
 const first=[{role:'user',content:'hello'}],history=[...first,{role:'assistant',content:'answer',tool_calls:[{id:'c1',function:{name:'clock',arguments:'{}'}}]},{role:'tool',tool_call_id:'c1',content:'time'},{role:'user',content:'next'}];
 const a=responsesRequest(first,tools,model,'a'),b=responsesRequest(history,[...tools].reverse(),model,'a');assert.equal(a.prompt_cache_key,b.prompt_cache_key);assert.notEqual(a.prompt_cache_key,responsesRequest(first,tools,model,'b').prompt_cache_key);assert.notEqual(a.prompt_cache_key,responsesRequest(first,tools,'other','a').prompt_cache_key);assert.notEqual(a.prompt_cache_key,responsesRequest(first,[{...tools[0],function:{...tools[0].function,description:'changed'}}],model,'a').prompt_cache_key);
 assert.equal(a.store,false);assert.equal(a.stream,true);assert.equal(b.input[1].role,'assistant');assert.equal(b.input[2].type,'function_call');assert.equal(b.input[3].type,'function_call_output');assert.equal(b.input[3].call_id,'c1');assert.equal(b.input[4].role,'user');
 const replay={role:'assistant',content:'visible',responseReplay:{provider:'codex-direct',model,items:[{type:'reasoning',id:'r1',encrypted_content:'opaque'},{type:'message',role:'assistant',content:[{type:'output_text',text:'visible'}]}]}};
 assert.equal(responsesInput([replay],model)[0].encrypted_content,'opaque');assert.deepEqual(responsesInput([replay],model)[0].summary,[]);assert.equal(replay.responseReplay.items[0].summary,undefined);assert.ok(!JSON.stringify(responsesInput([replay],'other')).includes('opaque'));assert.equal(responsesInput([replay],model).filter(i=>i.type==='message').length,1);
});

test('fragmented UTF-8 SSE commits only terminal output, reports inclusive usage once, and rejects incomplete streams',async()=>{
 const events=[{type:'response.output_text.delta',delta:'hé🙂'},completed([message('hé🙂')],{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:80},output_tokens_details:{reasoning_tokens:5}})];
 const reply=await provider(async(url,init)=>{assert.equal(String(url),DIRECT_RESPONSES_URL);assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer dummy-access');assert.ok(!JSON.stringify(JSON.parse(init.body)).includes('dummy-access'));return sse(events);}).complete([{role:'user',content:'hello'}],tools);
 assert.equal(reply.content,'hé🙂');assert.equal(reply.usage.metrics.input,100);assert.equal(reply.usage.metrics.cachedInput,80);assert.equal(reply.usage.metrics.total,110);assert.equal(reply.usage.scope,'request');
 for(const type of ['response.failed','response.incomplete','error'])await assert.rejects(provider(async()=>sse([{type,response:{status:'failed',error:{message:'dummy-access'}}}])).complete([],[]),error=>!error.message.includes('dummy-access'));
 await assert.rejects(provider(async()=>sse([{type:'response.output_text.delta',delta:'partial'}])).complete([],[]),/without response.completed/);
 assert.deepEqual(directUsage({}).metrics,{});assert.equal(directUsage({usage:{input_tokens:0,output_tokens:0}}).metrics.input,0);
});

const itemDone=(index,item)=>({type:'response.output_item.done',output_index:index,item});

test('direct streamed done message survives empty terminal output, persists usage/phase, and replays on the next turn',async t=>{
 const root=await fixture(t),store=new Store(root),session=await store.create();let requests=0;
 const p=provider(async(_,init)=>{
  requests++;const body=JSON.parse(init.body);
  if(requests===2){assert.equal(body.input[1].phase,'final_answer');assert.equal(body.input[1].content[0].text,'Staf is connected.');}
  const item={...message(requests===1?'Staf is connected.':'Still connected.'),id:'msg_'+requests,status:'completed',phase:'final_answer'};
  return sse([{type:'response.output_text.delta',delta:'provisional'},itemDone(0,item),itemDone(0,item),completed([],{input_tokens:64,output_tokens:9,total_tokens:73})],3);
 });
 await runTurn({store,session,provider:p,text:'Test'});
 assert.equal(session.messages[1].content,'Staf is connected.');assert.equal(session.events.filter(e=>e.type==='assistant').length,1);
 assert.equal(session.usage[0].metrics.input,64);assert.equal(session.usage[0].metrics.output,9);
 const saved=await store.load(session.id);assert.equal(saved.messages[1].responseReplay.items[0].phase,'final_answer');assert.ok(validSession(saved,saved.id));
 await runTurn({store,session:saved,provider:p,text:'Again'});assert.equal(saved.messages[3].content,'Still connected.');assert.equal(requests,2);
});

test('done items reconstruct ordered reasoning/tool replay only after success and never duplicate terminal output',async t=>{
 const root=await fixture(t),store=new Store(root),session=await store.create();let requests=0,clocks=0;
 const reasoning={type:'reasoning',id:'r',encrypted_content:'opaque'},call={type:'function_call',status:'completed',call_id:'c',name:'clock',arguments:'{}'};
 const p=provider(async(_,init)=>{
  requests++;
  if(requests===1)return sse([itemDone(1,call),itemDone(0,reasoning),itemDone(1,call),completed([],{input_tokens:10,output_tokens:2})],5);
  const body=JSON.parse(init.body);assert.equal(body.input[1].type,'reasoning');assert.deepEqual(body.input[1].summary,[]);assert.equal(body.input[2].call_id,'c');assert.equal(body.input[3].type,'function_call_output');
  // A full terminal snapshot is used once, rather than appended to done items.
  return sse([itemDone(0,message('done')),completed([message('done')],{input_tokens:15,output_tokens:2})],7);
 });
 await runTurn({store,session,provider:p,text:'time',clock:()=>{clocks++;return 'clock';}});
 assert.equal(clocks,1);assert.equal(requests,2);assert.equal(session.messages.at(-1).content,'done');assert.equal(session.usage.length,2);
 assert.equal(session.messages[1].responseReplay.items[0].type,'reasoning');
});

test('completed items remain provisional on failure, missing completion, malformed indexes, conflicts and partial-only output',async t=>{
 const root=await fixture(t),store=new Store(root),session=await store.create();let clocks=0;
 const call={type:'function_call',status:'completed',call_id:'c',name:'clock',arguments:'{}'};
 const cases=[
  [itemDone(0,call),{type:'response.failed'}],
  [itemDone(0,call),{type:'response.incomplete'}],
  [itemDone(0,call)],
  [itemDone(0,call),{type:'response.completed',response:{status:'incomplete',output:[]}}],
  [itemDone(1,call),completed([])],
  [itemDone(-1,call),completed([])],
  [itemDone(32,call),completed([])],
  [itemDone(0.5,call),completed([])],
  [itemDone(0,call),itemDone(0,{...call,arguments:'changed'}),completed([])],
  [itemDone(0,{...call,status:'incomplete'}),completed([])],
  [itemDone(0,{type:'native_shell',command:'no'}),completed([])],
  [itemDone(0,{...message('text'),phase:'invalid'}),completed([])],
  [{type:'response.output_text.delta',delta:'partial'},completed([])],
 ];
 for(const events of cases){
  await assert.rejects(runTurn({store,session,provider:provider(async()=>sse(events,7)),text:'time',clock:()=>{clocks++;return 'clock';}}));
  assert.equal(clocks,0);assert.deepEqual(session.messages,[]);assert.deepEqual((await store.load(session.id)).messages,[]);
 }
 const controller=new AbortController();
 const p=provider(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(itemDone(0,call))+'\n\n'));},cancel(){}})));
 const run=runTurn({store,session,provider:p,text:'cancel',signal:controller.signal,clock:()=>{clocks++;return 'clock';}});
 setTimeout(()=>controller.abort(),10);await assert.rejects(run);assert.equal(clocks,0);assert.deepEqual(session.messages,[]);
});

test('tool fragments/repeated events never execute twice; reasoning replay survives resume and strips on HTTP provider switch',async t=>{
 const root=await fixture(t),store=new Store(root),session=await store.create();let calls=0,clocks=0;
 const p=provider(async(_,init)=>{calls++;const body=JSON.parse(init.body);
  if(calls===1)return sse([{type:'response.function_call_arguments.delta',delta:'bad incomplete fragment'},completed([{type:'reasoning',id:'r1',encrypted_content:'opaque'},{type:'function_call',call_id:'c1',name:'clock',arguments:'{}'}],{input_tokens:10,output_tokens:2}),completed([{type:'function_call',call_id:'c1',name:'clock',arguments:'{}'}])],5);
  assert.ok(body.input.some(i=>i.type==='function_call_output'&&i.call_id==='c1'));assert.ok(body.input.some(i=>i.encrypted_content==='opaque'));return sse([completed([message('done')],{input_tokens:15,output_tokens:2})],7);
 });
 await runTurn({store,session,provider:p,text:'time',clock:()=>{clocks++;return 'clock';}});assert.equal(clocks,1);assert.equal(calls,2);assert.equal(session.usage.length,2);
 const resumed=await store.load(session.id);assert.ok(validSession(resumed,resumed.id));assert.equal(resumed.messages[1].responseReplay.items[0].encrypted_content,'opaque');
 const switched=liveProvider({STAF_API_KEY:'dummy',STAF_MODEL:'other'},async(_,init)=>{assert.ok(!init.body.includes('opaque'));assert.ok(!init.body.includes('responseReplay'));return Response.json({choices:[{message:{role:'assistant',content:'other'}}]});});
 await runTurn({store,session:resumed,provider:switched,text:'next'});assert.equal(resumed.turns.length,2);
 const invalid=structuredClone(resumed);invalid.messages[1].responseReplay.items=[{type:'native_shell',command:'no'}];assert.equal(validSession(invalid,invalid.id),false);
});

test('abort suppresses late results, failed terminal never dispatches tools, and errors redact bearer material',async t=>{
 const root=await fixture(t),store=new Store(root),session=await store.create();let clocks=0;
 await assert.rejects(runTurn({store,session,provider:provider(async()=>sse([{type:'response.output_item.done',output_index:0,item:{type:'function_call',call_id:'c',name:'clock',arguments:'{}'}},{type:'response.failed'}])),text:'time',clock:()=>{clocks++;return 'x';}}));assert.equal(clocks,0);assert.deepEqual(session.messages,[]);
 const controller=new AbortController();let cancelled=false;
 const p=provider(async()=>new Response(new ReadableStream({start(c){setTimeout(()=>{try{c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(completed([message('late')]))+'\n\n'));c.close();}catch{}},40);},cancel(){cancelled=true;}})));
 const run=runTurn({store,session,provider:p,text:'cancel',signal:controller.signal});setTimeout(()=>controller.abort(),5);await assert.rejects(run);assert.equal(cancelled,true);assert.deepEqual(session.messages,[]);
 const echoed=provider(async()=>sse([{type:'response.output_text.delta',delta:'dummy-'},{type:'response.output_text.delta',delta:'access'},completed([message('dummy-access')])],3));let output='';for await(const e of echoed.stream([],[]))output+=e.type==='text_delta'?e.text:e.type==='message'?e.message.content:'';assert.ok(!output.includes('dummy-access'));assert.match(output,/REDACTED/);
 await assert.rejects(provider(async()=>{throw Error('Bearer dummy-access');}).complete([],[]),error=>!error.message.includes('dummy-access'));
});

const keys=generateKeyPairSync('rsa',{modulusLength:2048});
function jwt(subject='subject',nonce='nonce'){const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'key'})).toString('base64url');const body=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',sub:subject,aud:'oaiapp_staf',nonce,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return header+'.'+body+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+body),keys.privateKey).toString('base64url');}
const attempt={state:'state',nonce:'nonce',verifier:'verifier',redirectUri:'http://127.0.0.1:12345/auth/callback',hostId:'urn:uuid:host',clientId:'dynamic_agent_client'};
function authFetch(subject='subject'){return async(url,init)=>{if(String(url).endsWith('/jwks.json'))return Response.json({keys:[{...keys.publicKey.export({format:'jwk'}),kid:'key'}]});assert.equal(String(url),'https://auth.openai.com/api/accounts/oauth/token');const params=new URLSearchParams(init.body);assert.equal(params.get('client_id'),'oaiapp_staf');assert.equal(params.get('resource'),'https://api.openai.com/v1');return Response.json({token_type:'Bearer',access_token:'dummy-access',refresh_token:'dummy-refresh',id_token:jwt(subject),expires_in:3600,scope:'openid resource.invoke chatgpt.tokens.use.direct offline_access'});};}

test('fresh direct registration binds PKCE/state/nonce/client/identity and writes separate private records only after consent callback',async t=>{
 const root=await fixture(t),url=new URL(authorizationUrl(attempt));assert.equal(url.hostname,'auth.openai.com');assert.equal(url.searchParams.get('agent_name_hint'),'Staf');assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(url.searchParams.get('ext_agent_host_id'),'urn:uuid:host');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 await assert.rejects(completeDirectLogin(root,attempt,new URL(attempt.redirectUri+'?code=x&state=bad&client_id=oaiapp_staf'),authFetch()),/state/);
 await assert.rejects(completeDirectLogin(root,attempt,new URL(attempt.redirectUri+'?error=access_denied&state=state'),authFetch()),/denied/);
 await assert.rejects(completeDirectLogin(root,attempt,new URL(attempt.redirectUri+'?code=x&state=state'),authFetch()),/incomplete/);
 await completeDirectLogin(root,attempt,new URL(attempt.redirectUri+'?code=x&state=state&client_id=oaiapp_staf'),authFetch());
 const saved=await loadDirectCredential(root);assert.equal(saved.clientId,'oaiapp_staf');assert.equal(saved.subject,'subject');assert.equal((await lstat(join(root,'auth','codex-direct.json'))).mode&0o777,0o600);
 const before=await readFile(join(root,'auth','codex-direct.json'),'utf8');await assert.rejects(completeDirectLogin(root,{...attempt,clientId:saved.clientId,previous:saved},new URL(attempt.redirectUri+'?code=x&state=state'),authFetch('other')),/differs/);assert.equal(await readFile(join(root,'auth','codex-direct.json'),'utf8'),before);
 await assert.rejects(validateIdToken(jwt('subject','wrong'),'oaiapp_staf','nonce',authFetch()),/binding/);
 assert.ok(!authorizationUrl({...attempt,previous:saved,clientId:saved.clientId}).includes(saved.idToken));
});

test('direct refresh is serialized, rotating and endpoint-bound; CLI tokens are never loaded or changed',async t=>{
 const root=await fixture(t);await mkdir(join(root,'codex-context','codex'),{recursive:true});await writeFile(join(root,'codex-context','codex','auth.json'),'do-not-read-or-copy');assert.match(await directAuth('status',root),/not signed in/);
 await completeDirectLogin(root,attempt,new URL(attempt.redirectUri+'?code=x&state=state&client_id=oaiapp_staf'),authFetch());const path=join(root,'auth','codex-direct.json');const record=await loadDirectCredential(root);await writeFile(path,JSON.stringify({...record,expiresAt:0}),{mode:0o600});
 let release;const gate=new Promise(r=>release=r);let count=0;const refresh=async(url,init)=>{count++;assert.equal(String(url),'https://auth.openai.com/api/accounts/oauth/token');assert.equal(new URLSearchParams(init.body).get('grant_type'),'refresh_token');await gate;return Response.json({token_type:'Bearer',access_token:'rotated-access',refresh_token:'rotated-refresh',expires_in:3600,scope:'resource.invoke chatgpt.tokens.use.direct'});};
 const one=directAccessToken(root,refresh);await new Promise(r=>setTimeout(r,20));await assert.rejects(directAccessToken(root,refresh),/busy/);release();assert.equal(await one,'rotated-access');assert.equal(count,1);assert.equal((await loadDirectCredential(root)).refreshToken,'rotated-refresh');assert.equal(await readFile(join(root,'codex-context','codex','auth.json'),'utf8'),'do-not-read-or-copy');
 await rm(path);await symlink(join(root,'codex-context','codex','auth.json'),path);await assert.rejects(loadDirectCredential(root));
});
