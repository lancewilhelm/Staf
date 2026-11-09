import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import type {GmailCredential} from './gmail-credential.js';

export const gmailScope='https://www.googleapis.com/auth/gmail.readonly';
const secret=z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/);
export const gmailStartSchema=z.strictObject({email:z.email().max(320).transform(value=>value.toLowerCase()),clientId:secret,clientSecret:secret});
const tokenResponse=z.object({access_token:secret,refresh_token:secret.optional(),scope:z.string().optional(),token_type:z.string()});
const profileSchema=z.object({emailAddress:z.email().max(320),historyId:z.string().regex(/^\d+$/)});
type Attempt={state:string;verifier:string;initiator:string;input:z.infer<typeof gmailStartSchema>;revision:number|null;expires:number;phase:'waiting'|'exchanging';controller:AbortController;timer?:ReturnType<typeof setTimeout>};
async function responseJson(response:Response):Promise<unknown> {
 if(!response.body)throw Error('Empty Google response');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
 try {while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>131072){await reader.cancel();throw Error('Google response too large');}chunks.push(value);}}finally{reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export class GmailAuth {
 private attempt:Attempt|undefined;
 private result='Not connected';
 constructor(private readonly request:typeof fetch,private readonly authorized:(token:string)=>boolean,private readonly revision:()=>number|null,private readonly commit:(credential:GmailCredential)=>void) {}
 status(){return this.attempt ? (this.attempt.phase==='waiting'?'Waiting for Google authorization':'Checking Gmail account') : this.result;}
 cancel(){const a=this.attempt;if(a){if(a.timer)clearTimeout(a.timer);a.controller.abort();this.attempt=undefined;this.result='Authorization cancelled';}}
 reset(){this.cancel();this.result='Not connected';}
 private assertAttempt(a:Attempt){a.controller.signal.throwIfAborted();if(this.attempt!==a || Date.now()>=a.expires || !this.authorized(a.initiator) || this.revision()!==a.revision)throw Error('Authorization expired or settings changed');}
 start(initiator:string,origin:string,input:unknown) {
  const uri=new URL(origin);if(uri.protocol!=='http:'||uri.hostname!=='127.0.0.1'||!uri.port||uri.origin!==origin)throw Error('Gmail authorization requires the loopback Staf address');
  const parsed=gmailStartSchema.parse(input);this.cancel();
  const a:Attempt={state:randomBytes(32).toString('base64url'),verifier:randomBytes(48).toString('base64url'),initiator,input:parsed,revision:this.revision(),expires:Date.now()+600000,phase:'waiting',controller:new AbortController()};this.attempt=a;
  a.timer=setTimeout(()=>{if(this.attempt===a){this.cancel();this.result='Authorization expired';}},600000);a.timer.unref();
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for(const [key,value] of Object.entries({client_id:parsed.clientId,redirect_uri:origin+'/gmail/oauth/callback',response_type:'code',scope:gmailScope,access_type:'offline',prompt:'consent',state:a.state,code_challenge:createHash('sha256').update(a.verifier).digest('base64url'),code_challenge_method:'S256',login_hint:parsed.email}))url.searchParams.set(key,value);
  this.result='Waiting for Google authorization';return {url:url.toString()};
 }
 async accept(method:string,target:string,origin:string):Promise<boolean> {
  const a=this.attempt;if(!a || a.phase!=='waiting'||method!=='GET')return false;
  const url=new URL(target,origin);if(url.pathname!=='/gmail/oauth/callback'||url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==a.state)return false;
  if(Date.now()>=a.expires || !this.authorized(a.initiator) || this.revision()!==a.revision){this.cancel();this.result='Authorization expired or settings changed';return false;}
  const codes=url.searchParams.getAll('code');if(codes.length!==1 || !codes[0] || codes[0].length>4096 || url.searchParams.has('error')){this.cancel();this.result='Google authorization was not completed';return false;}
  a.phase='exchanging';
  try {
   const body=new URLSearchParams({code:codes[0],client_id:a.input.clientId,client_secret:a.input.clientSecret,redirect_uri:origin+'/gmail/oauth/callback',grant_type:'authorization_code',code_verifier:a.verifier});
   const response=await this.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString(),redirect:'error',signal:AbortSignal.any([a.controller.signal,AbortSignal.timeout(15000)])});
   if(!response.ok)throw Error('Token exchange failed');const tokens=tokenResponse.parse(await responseJson(response));
   if(!tokens.refresh_token || tokens.token_type.toLowerCase()!=='bearer' || !tokens.scope?.split(/\s+/).includes(gmailScope))throw Error('Gmail permission or refresh token missing');
   this.assertAttempt(a);const profile=await this.profile(tokens.access_token,a.controller.signal);
   if(profile.emailAddress.toLowerCase()!==a.input.email)throw Error('Google account did not match');
   this.assertAttempt(a);
   this.commit({email:a.input.email,clientId:a.input.clientId,clientSecret:a.input.clientSecret,refreshToken:tokens.refresh_token});if(a.timer)clearTimeout(a.timer);this.attempt=undefined;this.result='Connected';return true;
  } catch {if(this.attempt===a){if(a.timer)clearTimeout(a.timer);this.attempt=undefined;this.result='Connection failed. Check the account, consent and Google client settings.';}return false;}
 }
 async profile(accessToken:string,signal?:AbortSignal) {
  const response=await this.request('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+accessToken},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Gmail account check failed');return profileSchema.parse(await responseJson(response));
 }
 async check(credential:GmailCredential,signal?:AbortSignal) {
  const body=new URLSearchParams({client_id:credential.clientId,client_secret:credential.clientSecret,refresh_token:credential.refreshToken,grant_type:'refresh_token'});
  const response=await this.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString(),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Gmail authorization unavailable');const tokens=tokenResponse.parse(await responseJson(response));if(tokens.token_type.toLowerCase()!=='bearer')throw Error('Gmail authorization unavailable');
  signal?.throwIfAborted();const profile=await this.profile(tokens.access_token,signal);if(profile.emailAddress.toLowerCase()!==credential.email)throw Error('Gmail account changed');
 }
}
