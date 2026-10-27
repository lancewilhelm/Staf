import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {completeDirectLogin,directAuth} from '../dist/codex-direct-auth.js';

const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const clientId='oaiapp_staf';
const attempt={state:'state',nonce:'nonce',verifier:'verifier',redirectUri:'http://127.0.0.1:12345/auth/callback',hostId:'urn:uuid:host',clientId};
const callback=new URL(attempt.redirectUri+'?code=code&state=state');
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
function idToken(nonce='nonce'){
 const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');
 const body=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',sub:'subject',aud:clientId,nonce,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
 return header+'.'+body+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+body),keys.privateKey).toString('base64url');
}
function tokenResponse(){return Response.json({token_type:'Bearer',access_token:'new-access',refresh_token:'new-refresh',id_token:idToken(),expires_in:3600,scope:'openid resource.invoke chatgpt.tokens.use.direct offline_access'});}
function jwksResponse(){return Response.json({keys:[{...keys.publicKey.export({format:'jwk'}),kid:'test'}]});}
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'staf-auth-cancel-'));await mkdir(join(root,'auth'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
const previous={version:1,issuer:'https://auth.openai.com',subject:'subject',clientId,hostId:attempt.hostId,accessToken:'old-access',refreshToken:'old-refresh',idToken:'old-id',scopes:['resource.invoke','chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000};

for(const stage of ['token','jwks'])for(const existing of [false,true]){
 test(`cancel during ${stage} prevents ${existing?'replacement of existing':'creation of'} credentials even if fetch ignores abort`,async t=>{
  const root=await fixture(t),path=join(root,'auth','codex-direct.json');
  const original=JSON.stringify(previous,null,2)+'\n';
  if(existing)await writeFile(path,original,{mode:0o600});
  const entered=deferred(),release=deferred(),controller=new AbortController();let receivedSignal;
  const request=async(url,init)=>{
   const isJwks=String(url).endsWith('/jwks.json');
   if(isJwks===(stage==='jwks')){receivedSignal=init.signal;entered.resolve();await release.promise;}
   return isJwks?jwksResponse():tokenResponse();
  };
  const completion=completeDirectLogin(root,{...attempt,...(existing?{previous}:{})},callback,request,controller.signal);
  const outcome=completion.then(()=>({ok:true}),error=>({ok:false,error}));
  await entered.promise;controller.abort(Error('test sign-in cancelled'));const propagated=receivedSignal?.aborted;release.resolve();
  const result=await outcome;
  assert.equal(result.ok,false,'a cancelled login must reject after its in-flight work drains');
  assert.match(result.error.message,/cancel|abort/i);
  assert.equal(propagated,true,'cancellation must reach the remote fetch');
  if(existing)assert.equal(await readFile(path,'utf8'),original,'existing credential bytes must survive cancellation');
  else await assert.rejects(readFile(path),{code:'ENOENT'});
  assert.deepEqual(await readdir(join(root,'auth')),existing?['codex-direct.json']:[],'no credential temp file or lock may remain');
 });
}

for(const cancellation of ['SIGINT','timeout'])for(const stage of ['token','jwks']){
 test(`loopback login ${cancellation} owns an active ${stage} callback until it stops`,async t=>{
  const root=await fixture(t),opened=deferred(),entered=deferred(),release=deferred();
  const nativeFetch=globalThis.fetch,listenerCount=process.listenerCount('SIGINT');let receivedSignal;
  if(cancellation==='timeout')t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(globalThis,'fetch',async(url,init)=>{
   const isJwks=String(url).endsWith('/jwks.json');
   if(isJwks===(stage==='jwks')){receivedSignal=init.signal;entered.resolve();await release.promise;throw Error('remote request stopped');}
   assert.equal(isJwks,false);return Response.json({token_type:'Bearer',access_token:'new-access',refresh_token:'new-refresh',id_token:idToken(new URL(opened.url).searchParams.get('nonce')),expires_in:3600,scope:'resource.invoke chatgpt.tokens.use.direct'});
  });
  let settled=false;
  const login=directAuth('login',root,message=>{opened.url=message.split('\n').at(-1);opened.resolve();});
  const outcome=login.then(value=>{settled=true;return{ok:true,value};},error=>{settled=true;return{ok:false,error};});
  let localRequest;
  try{
   await opened.promise;const authorization=new URL(opened.url),local=new URL(authorization.searchParams.get('redirect_uri'));
   local.search=new URLSearchParams({code:'code',state:authorization.searchParams.get('state'),client_id:clientId}).toString();
   localRequest=nativeFetch(local).then(response=>response.text(),error=>error);
   await entered.promise;
   if(cancellation==='SIGINT')process.emit('SIGINT');else t.mock.timers.tick(600000);
   await new Promise(setImmediate);
   const settledBeforeDrain=settled,propagated=receivedSignal?.aborted;
   release.resolve();const result=await outcome;await localRequest;
   assert.equal(settledBeforeDrain,false,'login cannot report cancellation while its callback could still commit');
   assert.equal(propagated,true,'the active remote request must receive cancellation');
   assert.equal(result.ok,false);assert.match(result.error.message,cancellation==='timeout'?/timed out/:/cancelled/);
   assert.equal(process.listenerCount('SIGINT'),listenerCount,'login must remove its signal listener');
   assert.deepEqual(await readdir(join(root,'auth')),['codex-host.json'],'login must leave no credential, lock or temp file');
   await assert.rejects(nativeFetch(local),'the loopback listener must close after cancellation');
  }finally{
   release.resolve();await outcome;if(localRequest)await localRequest;
  }
 });
}
