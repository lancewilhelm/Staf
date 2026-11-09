import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';
import {Instance} from '../dist/instance.js';
import {ActionJournal} from '../dist/action-journal.js';

const wait=async fn=>{for(let i=0;i<700;i++){const v=await fn();if(v)return v;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};

async function setup({uncertain=false,inflight=false,sendEnabled=true,mode='direct',proposedSubject='Synthetic subject'}={}) {
 const dir=mkdtempSync(join(tmpdir(),'staf-reply-')),path=join(dir,'db'),posts=[],sends=[];let interact,receive,sequence=0,refreshGate;
 const slackTransport={identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,_status,interactions)=>{receive=handler;interact=interactions;return ()=>{interact=undefined;receive=undefined}},post:async(_tokens,message)=>{const messageTs=String(++sequence)+'.1';posts.push({...message,messageTs});return {messageTs};}};
 const gmailRequest=async(url,options={})=>{
  const u=new URL(url);
  if(u.hostname==='oauth2.googleapis.com'){if(refreshGate && String(options.body).includes('grant_type=refresh_token')){refreshGate.entered();await refreshGate.wait;}return Response.json({access_token:'access',refresh_token:'refresh',scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',token_type:'Bearer'});}
  if(u.pathname.endsWith('/profile'))return Response.json({emailAddress:'owner@example.test',historyId:'10'});
  if(u.pathname.endsWith('/messages/m1'))return Response.json({id:'m1',threadId:'t1',payload:{mimeType:'text/plain',headers:[{name:'From',value:'friend@example.test'},{name:'Subject',value:'Synthetic subject'},{name:'Message-ID',value:'<original@example.test>'}],body:{data:Buffer.from('private synthetic message').toString('base64url')}}});
  if(u.pathname.endsWith('/messages/send')){sends.push(JSON.parse(options.body));if(inflight)return new Promise((_,reject)=>{if(options.signal.aborted)reject(Error('aborted'));else options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});if(uncertain)throw Error('connection lost');return Response.json({id:'sent1',threadId:'t1'});}
  throw Error('Unexpected Gmail request: '+u.pathname);
 };
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false},async complete(messages){const last=messages.findLastIndex(m=>m.role==='user'),results=messages.slice(last+1).filter(m=>m.role==='tool');if(mode==='code' && !results.length)return {role:'assistant',content:null,tool_calls:[{id:'code',type:'function',function:{name:'code_mode',arguments:JSON.stringify({source:'await capabilities.gmail_read({messageId:"m1"}); return await capabilities.gmail_reply({messageId:"m1",to:"friend@example.test",subject:"Synthetic subject",body:"Thank you!\\nSee you soon."});'})}}]};if(mode==='code')return {role:'assistant',content:'Finished.'};if(!results.length)return {role:'assistant',content:null,tool_calls:[{id:'read',type:'function',function:{name:'gmail_read',arguments:'{"messageId":"m1"}'}}]};if(results.length===1)return {role:'assistant',content:null,tool_calls:[{id:'reply',type:'function',function:{name:'gmail_reply',arguments:JSON.stringify({messageId:'m1',to:'friend@example.test',subject:proposedSubject,body:'Thank you!\nSee you soon.'})}}]};return {role:'assistant',content:'Finished.'};}});
 const options={env:{},gmailRequest,slackTransport,providerFactory,gmailPollIntervalMs:3600000};let app=startInstance(path,0,options),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [response.status,await response.json()];};
 const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Reply agent',provider:'live',model:'fixture',toolMode:mode}))[1];
 const attempt=(await call('/api/plugins/gmail/start',token,{email:'owner@example.test',clientId:'client',clientSecret:'secret',sendEnabled}))[1],u=new URL(attempt.url),cb=new URL(u.searchParams.get('redirect_uri'));assert.equal(u.searchParams.get('scope').includes('gmail.send'),sendEnabled);cb.searchParams.set('state',u.searchParams.get('state'));cb.searchParams.set('code','code');assert.equal((await fetch(cb)).status,200);
 for(const [route,body] of [['/api/plugins/gmail/access',{botId:bot.id,enabled:true}],['/api/plugins/gmail/enable',{}],['/api/plugins/gmail/model-access',{botId:bot.id,provider:'live',model:'fixture',enabled:true}],['/api/plugins/slack/connect',{appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id}],['/api/plugins/slack/access',{botId:bot.id,enabled:true}],['/api/plugins/slack/enable',{}]])assert.equal((await call(route,token,body))[0],200,route);
 await wait(()=>interact);const begin=async id=>{assert.equal((await call('/api/commands',token,{id,botId:bot.id,content:'Read the message and propose a reply'}))[0],200);return wait(async()=>{const p=posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_disclose') && !p.used);if(p)return p;const item=(await call('/api/commands/'+id,token))[1];if(item.state!=='pending')throw Error(JSON.stringify(item));return null;});};
 const click=async(post,actionId,override={})=>interact({eventId:'event-'+Math.random(),teamId:'T123',userId:'U123',channelId:'D123',messageTs:post.messageTs,actionId,value:post.buttons[0].value,...override});
 const restart=async()=>{await app.close();app=startInstance(path,0,options);port=await app.listen();await wait(()=>interact);};
 const beginSlack=async()=>{assert.equal((await call('/api/plugins/gmail/work-model-access',token,{botId:bot.id,provider:'live',model:'fixture',enabled:true}))[0],200);await receive({eventId:'EvReply',teamId:'T123',userId:'U123',channelId:'D123',messageTs:'77.1',text:'Read the message and propose a reply'});return wait(()=>posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_disclose')));};
 const holdRefresh=()=>{let entered,release;const started=new Promise(resolve=>{entered=resolve}),wait=new Promise(resolve=>{release=resolve});refreshGate={entered,wait};return {started,release:()=>{refreshGate=undefined;release();}};};
 return {dir,path,posts,sends,call,token,bot,begin,beginSlack,click,restart,holdRefresh,close:async()=>{await app.close();rmSync(dir,{recursive:true,force:true});}};
}

test('exact reply requires scoped disclosure and one approved Slack decision',async()=>{
 const f=await setup();try {
  const question=await f.begin('reply-ok');assert.doesNotMatch(question.text,/friend|subject|Thank you|private synthetic/i);
  await f.click(question,'gmail_disclose',{userId:'U999'});await f.click(question,'gmail_disclose',{teamId:'T999'});await f.click(question,'gmail_disclose',{channelId:'D999'});await f.click(question,'gmail_disclose',{messageTs:'old'});assert.equal(f.posts.filter(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')).length,0);
  await f.click(question,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));
  assert.match(proposal.text,/To: friend@example.test/);assert.match(proposal.text,/Subject: Synthetic subject/);assert.match(proposal.text,/Thank you!\nSee you soon\./);
  await f.click(question,'gmail_approve');await f.click(proposal,'gmail_approve',{userId:'U999'});await f.click(proposal,'gmail_approve',{value:'changed'});assert.equal(f.sends.length,0);
  await Promise.all([f.click(proposal,'gmail_approve'),f.click(proposal,'gmail_approve')]);await wait(()=>f.sends.length===1);await f.click(proposal,'gmail_approve');assert.equal(f.sends.length,1);
  const sent=f.sends[0],raw=Buffer.from(sent.raw,'base64url').toString();assert.equal(sent.threadId,'t1');assert.match(raw,/To: friend@example.test\r\n/);assert.match(raw,/In-Reply-To: <original@example.test>/);assert.equal(Buffer.from(raw.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1],'base64').toString(),'Synthetic subject');assert.equal(Buffer.from(raw.split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString(),'Thank you!\nSee you soon.');
  const work=await wait(async()=>{const item=(await f.call('/api/commands/reply-ok',f.token))[1];return item.state!=='pending'&&item;});assert.equal(work.workActions.find(a=>a.summary==='Send approved Gmail reply').state,'succeeded');
  await wait(()=>f.posts.some(post=>post.text==='The approved Gmail reply was sent.'));
  assert.equal((await f.call('/api/commands',f.token,{id:'repeat-completed',botId:f.bot.id,content:'Read the message and propose a reply'}))[0],200);const repeat=await wait(async()=>{const item=(await f.call('/api/commands/repeat-completed',f.token))[1];return item.state!=='pending'&&item;});assert.ok(repeat.workActions.some(a=>a.summary==='Send approved Gmail reply' && a.state==='cancelled'));assert.equal(f.sends.length,1);
 }finally{await f.close();}
});

test('a Slack-originated request uses the separately granted model boundary',async()=>{
 const f=await setup();try{
  const question=await f.beginSlack();assert.equal(question.threadTs,'77.1');await f.click(question,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));assert.equal(proposal.threadTs,'77.1');await f.click(proposal,'gmail_approve');await wait(()=>f.sends.length===1);
  const id='slack-'+createHash('sha256').update(JSON.stringify(['T123','EvReply'])).digest('hex');const work=await wait(async()=>{const value=(await f.call('/api/commands/'+id,f.token))[1];return value.state!=='pending'&&value;});assert.equal(work.gmailReplies[0].state,'succeeded');
 }finally{await f.close();}
});

test('Code Mode can read and propose through the same approval boundary',async()=>{
 const f=await setup({mode:'code'});try{const question=await f.begin('reply-code');await f.click(question,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));await f.click(proposal,'gmail_approve');await wait(()=>f.sends.length===1);}finally{await f.close();}
});

test('a connection without the optional send scope cannot propose or send',async()=>{
 const f=await setup({sendEnabled:false});try{assert.equal((await f.call('/api/commands',f.token,{id:'read-only',botId:f.bot.id,content:'Read the message and propose a reply'}))[0],200);await wait(async()=>{const item=(await f.call('/api/commands/read-only',f.token))[1];return item.state!=='pending'&&item;});assert.equal(f.posts.some(p=>p.buttons),false);assert.equal(f.sends.length,0);}finally{await f.close();}
});

test('a changed subject outside the original Gmail thread is rejected',async()=>{
 const f=await setup({proposedSubject:'Different subject'});try{assert.equal((await f.call('/api/commands',f.token,{id:'wrong-subject',botId:f.bot.id,content:'Read and reply'}))[0],200);await wait(async()=>{const item=(await f.call('/api/commands/wrong-subject',f.token))[1];return item.state!=='pending'&&item;});assert.equal(f.posts.some(p=>p.buttons),false);assert.equal(f.sends.length,0);}finally{await f.close();}
});

test('a changed stored effect invalidates its approval binding',()=>{
 const instance=new Instance(':memory:');try{
  const bot=instance.createBot({name:'Reply',instructions:'',provider:'live',model:'fixture'}),work={kind:'command',id:'proposal-work'};instance.claim({id:work.id,botId:bot.id,content:'Prepare a reply'});
  const journal=new ActionJournal(instance.db),actionId='action',fingerprint='fingerprint';journal.prepare({id:actionId,fingerprint,work,summary:'Send reply'});
  instance.createGmailReply({actionId,fingerprint,work,botId:bot.id,accountId:'owner@example.test',gmailRevision:1,slackRevision:1,teamId:'T123',userId:'U123',channelId:'D123',messageId:'m1',effect:JSON.stringify({to:'friend@example.test',body:'original'})});
  assert.equal(instance.gmailReplyIntact(actionId),true);instance.db.prepare("UPDATE gmail_reply_proposals SET effect=?,state='approved' WHERE action_id=?").run(JSON.stringify({to:'other@example.test',body:'changed'}),actionId);assert.equal(instance.gmailReplyIntact(actionId),false);assert.throws(()=>instance.gmailReplyStart(actionId),/approval changed/);
 }finally{instance.close();}
});

test('denial, revoked access, and restart make controls inert',async()=>{
 for(const scenario of ['deny','revoke','restart']){const f=await setup();try{
  const question=await f.begin('reply-'+scenario);await f.click(question,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));
  if(scenario==='deny')await f.click(proposal,'gmail_deny');
  if(scenario==='revoke')await f.call('/api/plugins/gmail/access',f.token,{botId:f.bot.id,enabled:false});
  if(scenario==='restart')await f.restart();
  await f.click(proposal,'gmail_approve');await new Promise(resolve=>setTimeout(resolve,30));assert.equal(f.sends.length,0,scenario);
 }finally{await f.close();}}
});

test('revocation after approval and before dispatch prevents the send',async()=>{
 for(const scenario of ['gmail-access','slack-access','model-access','gmail-disabled']){const f=await setup();let gate;try{const question=await f.begin('revoke-at-dispatch');await f.click(question,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));gate=f.holdRefresh();await f.click(proposal,'gmail_approve');await gate.started;
  if(scenario==='gmail-access')await f.call('/api/plugins/gmail/access',f.token,{botId:f.bot.id,enabled:false});
  if(scenario==='slack-access')await f.call('/api/plugins/slack/access',f.token,{botId:f.bot.id,enabled:false});
  if(scenario==='model-access')await f.call('/api/plugins/gmail/model-access',f.token,{botId:f.bot.id,provider:'live',model:'fixture',enabled:false});
  if(scenario==='gmail-disabled')await f.call('/api/plugins/gmail/disable',f.token,{});
  gate.release();await wait(async()=>{const item=(await f.call('/api/commands/revoke-at-dispatch',f.token))[1];return item.state!=='pending'&&item;});assert.equal(f.sends.length,0,scenario);
 }finally{gate?.release();await f.close();}}
});

test('an ambiguous send remains uncertain across restart and is never replayed',async()=>{
 const f=await setup({uncertain:true});try{
  const question=await f.begin('reply-uncertain');await f.click(question,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));await f.click(proposal,'gmail_approve');
  const work=await wait(async()=>{const item=(await f.call('/api/commands/reply-uncertain',f.token))[1];return item.workActions?.some(a=>a.state==='uncertain')&&item;});assert.equal(f.sends.length,1);
  await f.restart();await f.click(proposal,'gmail_approve');assert.equal(f.sends.length,1);
  assert.equal((await f.call('/api/commands',f.token,{id:'retry-blocked',botId:f.bot.id,content:'Read the message and propose a reply'}))[0],200);
  const blocked=await wait(async()=>{const item=(await f.call('/api/commands/retry-blocked',f.token))[1];return item.state!=='pending'&&item;});assert.ok(blocked.workActions.some(a=>a.summary==='Send approved Gmail reply' && a.state==='cancelled'));assert.equal(f.sends.length,1);
  const reply=work.gmailReplies[0];assert.equal((await f.call('/api/plugins/gmail/reconcile',f.token,{actionId:reply.actionId,fingerprint:'0'.repeat(64),outcome:'not-sent'}))[0],409);
  assert.equal((await f.call('/api/plugins/gmail/reconcile',f.token,{actionId:reply.actionId,fingerprint:reply.fingerprint,outcome:'not-sent'}))[0],200);
  assert.equal((await f.call('/api/plugins/gmail/reconcile',f.token,{actionId:reply.actionId,fingerprint:reply.fingerprint,outcome:'not-sent'}))[0],409);
 }finally{await f.close();}
});

test('restart while the Gmail request is in flight preserves an uncertain outcome',async()=>{
 const f=await setup({inflight:true});try{
  const question=await f.begin('reply-inflight');await f.click(question,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));await f.click(proposal,'gmail_approve');await wait(()=>f.sends.length===1);
  await f.restart();const item=(await f.call('/api/commands/reply-inflight',f.token))[1];assert.equal(item.gmailReplies[0].state,'uncertain');assert.equal(item.workActions.find(a=>a.summary==='Send approved Gmail reply').state,'uncertain');await f.click(proposal,'gmail_approve');assert.equal(f.sends.length,1);
 }finally{await f.close();}
});
