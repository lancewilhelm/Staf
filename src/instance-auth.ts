import {randomBytes} from 'node:crypto';
import {authorizationUrl,directLoginCallback} from './codex-direct-auth.js';
import type {LoginAttempt} from './codex-direct-auth.js';

type Phase = 'waiting' | 'exchanging' | 'committing' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
type Status = {id:string; phase:Phase; expiresAt:number};
type Active = {id:string; initiator:string; attempt:LoginAttempt; controller:AbortController; expiresAt:number; phase:Phase};
type Options = {
 redirectUri:string;
 authorizationUrl?:typeof authorizationUrl;
 prepare:()=>Promise<Pick<LoginAttempt,'hostId'|'clientId'|'previous'>>;
 authorized:(initiator:string)=>Promise<boolean>;
 complete:(attempt:LoginAttempt, callback:URL, signal:AbortSignal, beforeCommit:()=>Promise<void>)=>Promise<void>;
 now?:()=>number;
 lifetimeMs?:number;
};

/** In-memory only. The service must route callbacks without logging their query string. */
export class InstanceAuth {
 private current:Active|undefined;
 private closed=false;
 private readonly now:()=>number;
 private readonly lifetimeMs:number;
 constructor(private readonly options:Options){
  const uri=new URL(options.redirectUri);
  if(uri.protocol!=='http:'||uri.hostname!=='127.0.0.1'||!uri.port||uri.pathname!=='/auth/callback'||uri.search||uri.hash||uri.username||uri.password||uri.toString()!==options.redirectUri)throw Error('Invalid loopback redirect');
  this.now=options.now??Date.now;this.lifetimeMs=options.lifetimeMs??600000;
  if(!Number.isFinite(this.lifetimeMs)||this.lifetimeMs<=0)throw Error('Invalid attempt lifetime');
 }
 private expire(a:Active):void{if((a.phase==='waiting'||a.phase==='exchanging')&&this.now()>=a.expiresAt){a.phase='expired';a.controller.abort();}}
 private view(a:Active):Status{return{id:a.id,phase:a.phase,expiresAt:a.expiresAt};}
 private phase(a:Active):Phase{return a.phase;}
 async start(initiator:string):Promise<Status & {url:string}>{
  if(!initiator||this.closed)throw Error('Sign-in unavailable');
  if(this.current){this.expire(this.current);if(['waiting','exchanging','committing'].includes(this.current.phase))throw Error('Sign-in already in progress');}
  // Reserve synchronously so concurrent starts cannot both prepare.
  const a:Active={id:randomBytes(24).toString('base64url'),initiator,attempt:{state:'',nonce:'',verifier:'',redirectUri:this.options.redirectUri,hostId:'',clientId:''},controller:new AbortController(),expiresAt:this.now()+this.lifetimeMs,phase:'waiting'};
  this.current=a;
  const timer=setTimeout(()=>this.expire(a),this.lifetimeMs);timer.unref();
  try{
   if(!await this.options.authorized(initiator))throw Error('Client is not authorized');
   const prepared=await this.options.prepare();
   this.expire(a);
   if(a.phase!=='waiting'||this.closed)throw Error('Sign-in interrupted');
   a.attempt={...prepared,state:randomBytes(32).toString('base64url'),nonce:randomBytes(32).toString('base64url'),verifier:randomBytes(48).toString('base64url'),redirectUri:this.options.redirectUri};
   return {...this.view(a),url:(this.options.authorizationUrl??authorizationUrl)(a.attempt)};
  }catch{if(a.phase==='waiting')a.phase='failed';throw Error('Unable to start sign-in');}
 }
 currentStatus(initiator:string):Status|undefined{const a=this.current;if(!a||a.initiator!==initiator)return undefined;this.expire(a);return this.view(a);}
 status(initiator:string,id:string):Status|undefined{const a=this.current;if(!a||a.id!==id||a.initiator!==initiator)return undefined;this.expire(a);return this.view(a);}
 cancel(initiator:string,id:string):Status|undefined{const a=this.current;if(!a||a.id!==id||a.initiator!==initiator)return undefined;this.expire(a);if(a.phase==='waiting'||a.phase==='exchanging'){a.phase='cancelled';a.controller.abort();}return this.view(a);}
 shutdown():void{this.closed=true;const a=this.current;if(a&&(a.phase==='waiting'||a.phase==='exchanging')){a.phase='cancelled';a.controller.abort();}}
 async accept(method:string,target:string):Promise<'accepted'|'rejected'>{
  const a=this.current;if(!a)return 'rejected';this.expire(a);
  if(a.phase!=='waiting')return 'rejected';
  const callback=directLoginCallback(method,target,a.attempt);if(!callback)return 'rejected';
  a.phase='exchanging';
  try{
   await this.options.complete(a.attempt,callback,a.controller.signal,async()=>{
    this.expire(a);a.controller.signal.throwIfAborted();
    if(a.phase!=='exchanging'||!await this.options.authorized(a.initiator))throw Error('Client authorization revoked');
    this.expire(a);a.controller.signal.throwIfAborted();
    if(a.phase!=='exchanging')throw Error('Sign-in interrupted');
    a.phase='committing';
   });
   if(this.phase(a)!=='committing')throw Error('Commit boundary was not entered');
   a.phase='succeeded';return 'accepted';
  }catch{if(this.phase(a)==='exchanging'||this.phase(a)==='committing')a.phase='failed';return 'rejected';}
 }
}
