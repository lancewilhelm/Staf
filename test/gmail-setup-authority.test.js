import test from 'node:test';
import assert from 'node:assert/strict';
import {GmailAuth,gmailScope} from '../dist/gmail-auth.js';

const input={email:'owner@example.test',clientId:'synthetic-client',clientSecret:'synthetic-client-secret'};
const origin='http://127.0.0.1:1234';
const callback=url=>{const auth=new URL(url);return `/gmail/oauth/callback?state=${encodeURIComponent(auth.searchParams.get('state'))}&code=synthetic-code`;};

test('Gmail attempt checks its scoped authority before token dispatch',async()=>{
 let allowed=true,requests=0,commits=0;
 const auth=new GmailAuth(async()=>{requests++;throw Error('Unexpected request');},()=>true,()=>'',()=>{throw Error('Unexpected default commit');},()=>{},()=>{});
 const attempt=auth.start('client',origin,input,{assertAuthority(){if(!allowed)throw Error('Grant revoked');},commit(){commits++;}});
 allowed=false;assert.equal(await auth.accept('GET',callback(attempt.url),origin),false);assert.equal(requests,0);assert.equal(commits,0);assert.match(auth.status(),/expired|changed/i);
});

test('Gmail attempt rechecks scoped authority after token exchange and before commit',async()=>{
 let allowed=true,profileCalls=0,commits=0,release,started;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
 const auth=new GmailAuth(async url=>{if(new URL(url).hostname==='oauth2.googleapis.com'){started();await gate;return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',scope:gmailScope,token_type:'Bearer'});}profileCalls++;return Response.json({emailAddress:input.email,historyId:'100'});},()=>true,()=>'',()=>{throw Error('Unexpected default commit');},()=>{},()=>{});
 const attempt=auth.start('client',origin,input,{assertAuthority(){if(!allowed)throw Error('Grant revoked');},commit(){commits++;}});const pending=auth.accept('GET',callback(attempt.url),origin);await entered;allowed=false;release();assert.equal(await pending,false);assert.equal(profileCalls,0);assert.equal(commits,0);
});

test('Gmail attempt commits only the checked Google profile using its attempt-specific binding',async()=>{
 let allowed=true,committed,defaultCommits=0;
 const auth=new GmailAuth(async url=>new URL(url).hostname==='oauth2.googleapis.com'?Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',scope:gmailScope,token_type:'Bearer'}):Response.json({emailAddress:input.email,historyId:'100'}),()=>true,()=>'',()=>{defaultCommits++;},()=>{},()=>{});
 const options={assertAuthority(){if(!allowed)throw Error('Grant revoked');},commit(credential,historyId){committed={credential,historyId};}};
 const first=auth.start('client',origin,input,options);assert.equal(await auth.accept('GET',callback(first.url),origin),true);assert.equal(committed.historyId,'100');assert.equal(committed.credential.clientSecret,input.clientSecret);assert.equal(defaultCommits,0);
 let release,started;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);committed=undefined;
 const held=new GmailAuth(async url=>{if(new URL(url).hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',scope:gmailScope,token_type:'Bearer'});started();await gate;return Response.json({emailAddress:input.email,historyId:'100'});},()=>true,()=>'',()=>{defaultCommits++;},()=>{},()=>{});
 const second=held.start('client',origin,input,options),pending=held.accept('GET',callback(second.url),origin);await entered;allowed=false;release();assert.equal(await pending,false);assert.equal(committed,undefined);assert.equal(defaultCommits,0);
});
