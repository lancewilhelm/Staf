import test from 'node:test';
import assert from 'node:assert/strict';
import {InstanceAuth} from '../dist/instance-auth.js';

function fixture(overrides={}) {
 let now=1000, authorized=true, committed=0;
 const coordinator=new InstanceAuth({redirectUri:'http://127.0.0.1:3210/auth/callback',now:()=>now,lifetimeMs:100,prepare:async()=>({hostId:'host',clientId:'dynamic_agent_client'}),authorized:async()=>authorized,complete:async(_attempt,_callback,signal,beforeCommit)=>{signal.throwIfAborted();await beforeCommit();committed++},...overrides});
 return {coordinator,advance:()=>{now+=101},revoke:()=>{authorized=false},committed:()=>committed};
}
function callback(start,extra={}){const url=new URL(start.url);return '/auth/callback?'+new URLSearchParams({state:url.searchParams.get('state'),code:'secret-code',client_id:'client',...extra})}

test('success is single use and status is scoped to the initiator',async()=>{
 const {coordinator,committed}=fixture();const started=await coordinator.start('alice');
 assert.equal(coordinator.status('bob',started.id),undefined);assert.equal(coordinator.cancel('bob',started.id),undefined);
 assert.equal(await coordinator.accept('GET',callback(started)),'accepted');assert.equal(committed(),1);
 assert.equal(coordinator.status('alice',started.id).phase,'succeeded');assert.equal(await coordinator.accept('GET',callback(started)),'rejected');
 assert.doesNotMatch(JSON.stringify(coordinator.status('alice',started.id)),/secret-code|verifier|token/);
});
test('wrong state, duplicate parameters, and malformed requests do not consume an attempt',async()=>{
 const {coordinator}=fixture();const started=await coordinator.start('alice');const valid=callback(started);
 for(const [method,path] of [['POST',valid],['GET',callback(started,{state:'wrong'})],['GET',valid+'&state=other'],['GET','/other?state=x'],['GET',valid+'x'.repeat(8193)]])assert.equal(await coordinator.accept(method,path),'rejected');
 assert.equal(coordinator.status('alice',started.id).phase,'waiting');assert.equal(await coordinator.accept('GET',valid),'accepted');
});
test('expiry, cancellation, and revocation prevent a commit',async()=>{
 for(const action of ['expiry','cancel','revoke']){const f=fixture(),s=await f.coordinator.start('alice');if(action==='expiry')f.advance();if(action==='cancel')f.coordinator.cancel('alice',s.id);if(action==='revoke')f.revoke();assert.equal(await f.coordinator.accept('GET',callback(s)),'rejected');assert.equal(f.committed(),0);}
});
test('cancellation during exchange aborts before commit',async()=>{
 let release,entered;const waiting=new Promise(r=>{release=r}),startedExchange=new Promise(r=>{entered=r});
 const f=fixture({complete:async(_a,_c,signal,beforeCommit)=>{entered();await waiting;signal.throwIfAborted();await beforeCommit();throw Error('unexpected')}});
 const s=await f.coordinator.start('alice'),response=f.coordinator.accept('GET',callback(s));await startedExchange;assert.equal(f.coordinator.cancel('alice',s.id).phase,'cancelled');release();assert.equal(await response,'rejected');assert.equal(f.coordinator.status('alice',s.id).phase,'cancelled');
});
test('commit boundary reports an in-flight commit rather than a false cancellation',async()=>{
 let release,entered;const waiting=new Promise(r=>{release=r}),committing=new Promise(r=>{entered=r});
 const f=fixture({complete:async(_a,_c,_signal,beforeCommit)=>{await beforeCommit();entered();await waiting}});
 const s=await f.coordinator.start('alice'),response=f.coordinator.accept('GET',callback(s));await committing;assert.equal(f.coordinator.cancel('alice',s.id).phase,'committing');release();assert.equal(await response,'accepted');
});
