import {randomBytes,randomUUID,createHash,createPublicKey,verify as verifySignature,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,lstat,open,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {isRecord,hasCode} from './validation.js';

export const DIRECT_RESOURCE='https://api.openai.com/v1';
export const DIRECT_TOKEN_URL='https://auth.openai.com/api/accounts/oauth/token';
const scopes=['openid','profile','email','offline_access','resource.invoke','chatgpt.tokens.use.direct'];
export interface DirectCredential {version:1;issuer:string;subject:string;clientId:string;hostId:string;accessToken:string;refreshToken:string;idToken:string;scopes:string[];expiresAt:number;refreshAfter?:number}
function text(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<65536;}
function valid(raw:unknown):raw is DirectCredential{return isRecord(raw)&&raw.version===1&&raw.issuer==='https://auth.openai.com'&&text(raw.subject)&&text(raw.clientId)&&raw.clientId!=='dynamic_agent_client'&&text(raw.hostId)&&text(raw.accessToken)&&text(raw.refreshToken)&&text(raw.idToken)&&Array.isArray(raw.scopes)&&raw.scopes.every(s=>typeof s==='string')&&raw.scopes.includes('chatgpt.tokens.use.direct')&&raw.scopes.includes('resource.invoke')&&typeof raw.expiresAt==='number'&&Number.isFinite(raw.expiresAt)&&(raw.refreshAfter===undefined||typeof raw.refreshAfter==='number'&&Number.isFinite(raw.refreshAfter));}
async function readJson(path:string):Promise<unknown>{let file;try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch{throw Error('Staf direct Codex is not signed in. Use /auth codex login inside Staf (or pnpm start auth codex login). CLI credentials are not reused.');}try{const stat=await file.stat();if(!stat.isFile()||stat.size>262144)throw Error('Unsafe direct credential record');return JSON.parse(await file.readFile('utf8')) as unknown;}finally{await file.close();}}
async function directory(root:string,create=false):Promise<string>{const base=resolve(root),path=join(base,'auth');for(const dir of [base,path]){if(create)await mkdir(dir,{recursive:true,mode:0o700});const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Direct auth requires real private directories');}return path;}
async function atomic(path:string,value:unknown,signal?:AbortSignal):Promise<void>{
 signal?.throwIfAborted();
 try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe auth destination');}catch(error){if(!hasCode(error,'ENOENT'))throw error;}
 signal?.throwIfAborted();
 const temp=path+'.'+randomUUID()+'.tmp';
 const file=await open(temp,'wx',0o600);
 try{
  try{signal?.throwIfAborted();await file.writeFile(JSON.stringify(value)+'\n');signal?.throwIfAborted();await file.sync();}finally{await file.close();}
  signal?.throwIfAborted();
  // Once rename starts, a successful commit wins over cancellation.
  await rename(temp,path);
 }finally{await unlink(temp).catch(()=>{});}
}
export async function loadDirectCredential(root:string):Promise<DirectCredential>{try{const dir=await directory(root);const raw=await readJson(join(dir,'codex-direct.json'));if(!valid(raw))throw Error('Invalid credential');return raw;}catch{throw Error('Staf direct Codex is not signed in or its record is invalid. Use /auth codex login inside Staf (or pnpm start auth codex login). Existing CLI login is not borrowed.');}}
async function locked<T>(root:string,work:(dir:string)=>Promise<T>):Promise<T>{const dir=await directory(root,true);const path=join(dir,'codex-direct.lock');const lock=await open(path,'wx',0o600).catch(()=>{throw Error('Direct auth is busy or locked after a crash; do not race a rotating refresh token.');});try{return await work(dir);}finally{await lock.close();await unlink(path);}}
async function tokenRequest(fields:Record<string,string>,request:typeof fetch,signal?:AbortSignal):Promise<Record<string,unknown>>{let response;try{response=await request(DIRECT_TOKEN_URL,{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),signal:AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])])});}catch{throw Error('Direct sign-in/refresh connection failed; no credentials replaced.');}if(!response.ok)throw Error('Direct sign-in/refresh rejected. Sign in again; no automatic token-exchange retry.');let raw:unknown;try{raw=await response.json();}catch{throw Error('Invalid OAuth response');}if(!isRecord(raw))throw Error('Invalid OAuth response');return raw;}
function tokenFields(raw:Record<string,unknown>,now:number){if(!text(raw.access_token)||!text(raw.refresh_token)||raw.token_type!=='Bearer'||typeof raw.expires_in!=='number'||!Number.isFinite(raw.expires_in)||raw.expires_in<=0||typeof raw.scope!=='string')throw Error('Incomplete OAuth token response; nothing saved');const granted=raw.scope.split(/\s+/);if(!granted.includes('chatgpt.tokens.use.direct')||!granted.includes('resource.invoke'))throw Error('ChatGPT plan usage was not granted; no API-key fallback');const earliest=typeof raw.earliest_refresh_at==='number'?raw.earliest_refresh_at*1000:typeof raw.earliest_refresh_at==='string'?Date.parse(raw.earliest_refresh_at):undefined;return{accessToken:raw.access_token,refreshToken:raw.refresh_token,scopes:granted,expiresAt:now+raw.expires_in*1000,...(earliest!==undefined&&Number.isFinite(earliest)?{refreshAfter:earliest}:{})};}
/** Uses only Staf's separately issued direct grant, serialized across processes. Never reads CLI auth. */
export async function directAccessToken(root:string,request:typeof fetch=fetch,signal?:AbortSignal):Promise<string>{let credential=await loadDirectCredential(root);if(credential.expiresAt>Date.now()+60000)return credential.accessToken;return locked(root,async dir=>{credential=await loadDirectCredential(root);if(credential.expiresAt>Date.now()+60000)return credential.accessToken;if(credential.refreshAfter&&Date.now()<credential.refreshAfter)throw Error('Direct token cannot refresh yet; retry later or sign in again');const raw=await tokenRequest({grant_type:'refresh_token',client_id:credential.clientId,refresh_token:credential.refreshToken,resource:DIRECT_RESOURCE},request,signal);const next={...credential,...tokenFields(raw,Date.now())};await atomic(join(dir,'codex-direct.json'),next);return next.accessToken;});}
export interface LoginAttempt {state:string;nonce:string;verifier:string;redirectUri:string;hostId:string;clientId:string;previous?:DirectCredential}
export function authorizationUrl(attempt:LoginAttempt):string{const url=new URL('https://auth.openai.com/api/accounts/authorize');url.search=new URLSearchParams({client_id:attempt.clientId,...(attempt.clientId==='dynamic_agent_client'?{agent_name_hint:'Staf'}:{}),ext_agent_host_id:attempt.hostId,response_type:'code',redirect_uri:attempt.redirectUri,scope:scopes.join(' '),resource:DIRECT_RESOURCE,state:attempt.state,nonce:attempt.nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(attempt.verifier).digest('base64url')}).toString();return url.toString();}
/** Signature and OIDC binding validation; no unverified token identity becomes a credential record. */
export async function validateIdToken(token:string,clientId:string,nonce:string,request:typeof fetch=fetch,signal?:AbortSignal):Promise<{subject:string}>{try{signal?.throwIfAborted();const parts=token.split('.');if(parts.length!==3)throw Error();const header:unknown=JSON.parse(Buffer.from(parts[0]||'','base64url').toString());const body:unknown=JSON.parse(Buffer.from(parts[1]||'','base64url').toString());if(!isRecord(header)||header.alg!=='RS256'||!text(header.kid)||!isRecord(body)||body.iss!=='https://auth.openai.com'||!text(body.sub)||body.nonce!==nonce||typeof body.exp!=='number'||body.exp*1000<=Date.now()||(typeof body.nbf==='number'&&body.nbf*1000>Date.now()+30000)||!(body.aud===clientId||Array.isArray(body.aud)&&body.aud.includes(clientId))||(Array.isArray(body.aud)&&body.aud.length>1&&body.azp!==clientId))throw Error();const response=await request('https://auth.openai.com/.well-known/jwks.json',{redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[])])});signal?.throwIfAborted();if(!response.ok)throw Error();const jwks:unknown=await response.json();signal?.throwIfAborted();if(!isRecord(jwks)||!Array.isArray(jwks.keys))throw Error();const key=jwks.keys.find((k:unknown)=>isRecord(k)&&k.kid===header.kid&&k.kty==='RSA'&&typeof k.n==='string'&&typeof k.e==='string');if(!isRecord(key)||typeof key.n!=='string'||typeof key.e!=='string')throw Error();const publicKey=createPublicKey({key:{kty:'RSA',n:key.n,e:key.e},format:'jwk'});if(!verifySignature('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2]||'','base64url')))throw Error();return{subject:body.sub};}catch{signal?.throwIfAborted();throw Error('ID-token signature or identity binding failed; no credentials saved');}}
export async function completeDirectLogin(root:string,attempt:LoginAttempt,callback:URL,request:typeof fetch=fetch,signal?:AbortSignal):Promise<void>{
 signal?.throwIfAborted();
 const state=callback.searchParams.get('state')||'';
 if(state.length!==attempt.state.length||!timingSafeEqual(Buffer.from(state),Buffer.from(attempt.state)))throw Error('OAuth state mismatch');
 if(callback.searchParams.has('error'))throw Error('Sign-in denied or cancelled; existing credentials unchanged');
 const client=callback.searchParams.get('client_id')||attempt.clientId;
 const code=callback.searchParams.get('code');
 if(!code||client==='dynamic_agent_client'||!/^[-A-Za-z0-9_]{1,200}$/.test(client)||attempt.clientId!=='dynamic_agent_client'&&client!==attempt.clientId)throw Error('Registration incomplete or client binding changed');
 const raw=await tokenRequest({grant_type:'authorization_code',client_id:client,code,code_verifier:attempt.verifier,redirect_uri:attempt.redirectUri,resource:DIRECT_RESOURCE},request,signal);
 signal?.throwIfAborted();
 if(!text(raw.id_token))throw Error('OAuth ID token missing');
 const identity=await validateIdToken(raw.id_token,client,attempt.nonce,request,signal);
 signal?.throwIfAborted();
 if(attempt.previous&&attempt.previous.subject!==identity.subject)throw Error('Sign-in account differs from selected registration; existing credentials unchanged');
 const record:DirectCredential={version:1,issuer:'https://auth.openai.com',subject:identity.subject,clientId:client,hostId:attempt.hostId,idToken:raw.id_token,...tokenFields(raw,Date.now())};
 await locked(root,async dir=>{
  signal?.throwIfAborted();
  let current:DirectCredential|undefined;
  try{current=await loadDirectCredential(root);}catch{}
  signal?.throwIfAborted();
  if(current&&(!attempt.previous||current.clientId!==attempt.previous.clientId||current.subject!==attempt.previous.subject))throw Error('Direct registration changed during sign-in; restart without replacing credentials');
  await atomic(join(dir,'codex-direct.json'),record,signal);
 });
}
/** User-run command only. Preparing code does not invoke this flow or create a grant. */
export async function directAuth(action:string,root:string,print=(text:string)=>console.log(text)):Promise<string>{if(action==='status'){try{const c=await loadDirectCredential(root);return`Staf direct Codex registration present; token expires ${new Date(c.expiresAt).toISOString()}. No network check.`;}catch{return'Staf direct Codex not signed in. Use /auth codex login inside Staf (or pnpm start auth codex login). CLI credentials remain separate.';}}if(action==='logout'){await locked(root,dir=>unlink(join(dir,'codex-direct.json')).catch(error=>{if(!hasCode(error,'ENOENT'))throw error;}));return'Staf direct credentials removed. CLI login was not selected.';}if(action!=='login')throw Error('Use auth codex login|status|logout');let previous:DirectCredential|undefined;try{previous=await loadDirectCredential(root);}catch{}const hostId=await locked(root,async dir=>{const path=join(dir,'codex-host.json');try{const raw=await readJson(path);if(!isRecord(raw)||raw.version!==1||!text(raw.hostId))throw Error('Malformed host ID');return raw.hostId;}catch(error){try{await lstat(path);throw error;}catch(check){if(!hasCode(check,'ENOENT'))throw error;}const hostId='urn:uuid:'+randomUUID();await atomic(path,{version:1,hostId});return hostId;}});return new Promise((resolveResult,reject)=>{
 let phase:'waiting'|'callback'|'settled'='waiting';
 let attempt:LoginAttempt;
 const controller=new AbortController();
 const server=createServer(async(req,res)=>{
  if(!req.url){res.writeHead(400).end();return;}
  const callback=new URL(req.url,attempt.redirectUri);
  if(callback.pathname!=='/auth/callback'||phase!=='waiting'){res.writeHead(404).end();return;}
  phase='callback';
  try{
   await completeDirectLogin(root,attempt,callback,fetch,controller.signal);
   res.writeHead(200,{'Content-Type':'text/plain'}).end('Staf sign-in complete. Return to your terminal.');
   finish({value:'Staf direct ChatGPT registration saved. No CLI tokens imported.'});
  }catch{
   res.writeHead(400,{'Content-Type':'text/plain'}).end('Sign-in failed or cancelled. Return to Staf; credentials were not replaced.');
   const reason:unknown=controller.signal.reason;
   finish({error:reason instanceof Error?reason:Error('Direct sign-in failed or cancelled; run login again.')});
  }
 });
 const finish=(outcome:{value:string}|{error:Error})=>{
  if(phase==='settled')return;
  phase='settled';
  clearTimeout(timer);process.off('SIGINT',interrupt);server.close();server.closeAllConnections();
  if('value' in outcome)resolveResult(outcome.value);else reject(outcome.error);
 };
 const cancel=(error:Error)=>{
  if(phase==='settled')return;
  controller.abort(error);
  if(phase==='waiting')finish({error});
 };
 const interrupt=()=>cancel(Error('Direct sign-in cancelled'));
 const timer=setTimeout(()=>cancel(Error('Direct sign-in timed out')),600000);
 server.once('error',()=>cancel(Error('Cannot listen on loopback for Staf sign-in')));
 process.once('SIGINT',interrupt);
 server.listen(0,'127.0.0.1',()=>{
  const address=server.address();
  if(!address||typeof address==='string'){interrupt();return;}
  attempt={state:randomBytes(32).toString('base64url'),nonce:randomBytes(32).toString('base64url'),verifier:randomBytes(48).toString('base64url'),redirectUri:`http://127.0.0.1:${address.port}/auth/callback`,hostId,clientId:previous?.clientId||'dynamic_agent_client',previous};
  print('Continue with ChatGPT — open this URL yourself to authorize Staf:\n'+authorizationUrl(attempt));
 });
});}
