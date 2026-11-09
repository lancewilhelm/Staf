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

async function setup({uncertain=false,inflight=false,sendEnabled=true,modifyEnabled=false,modifyAction,uncertainModify=false,inflightModify=false,mode='direct',proposedSubject='Synthetic subject',proposedBody='Thank you!\nSee you soon.'}={}) {
 const dir=mkdtempSync(join(tmpdir(),'staf-reply-')),path=join(dir,'db'),posts=[],sends=[],changes=[];let interact,receive,sequence=0,refreshGate,labels=[{id:'Label_1',name:'Projects',type:'user'}];
 const slackTransport={identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,_status,interactions)=>{receive=handler;interact=interactions;return ()=>{interact=undefined;receive=undefined}},post:async(_tokens,message)=>{const messageTs=String(++sequence)+'.1';posts.push({...message,messageTs});return {messageTs};}};
 const gmailRequest=async(url,options={})=>{
  const u=new URL(url);
  if(u.hostname==='oauth2.googleapis.com'){if(refreshGate && String(options.body).includes('grant_type=refresh_token')){refreshGate.entered();await refreshGate.wait;}return Response.json({access_token:'access',refresh_token:'refresh',scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify',token_type:'Bearer'});}
  if(u.pathname.endsWith('/profile'))return Response.json({emailAddress:'owner@example.test',historyId:'10'});
  if(u.pathname.endsWith('/messages/m1'))return Response.json({id:'m1',threadId:'t1',payload:{mimeType:'text/plain',headers:[{name:'From',value:'friend@example.test'},{name:'Subject',value:'Synthetic subject'},{name:'Message-ID',value:'<original@example.test>'}],body:{data:Buffer.from('private synthetic message').toString('base64url')}}});
  if(u.pathname.endsWith('/labels'))return Response.json({labels});
  if(u.pathname.endsWith('/messages/m1/modify')){changes.push(JSON.parse(options.body));if(inflightModify)return new Promise((_,reject)=>{if(options.signal.aborted)reject(Error('aborted'));else options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});if(uncertainModify)throw Error('connection lost');return Response.json({id:'m1'});}
  if(u.pathname.endsWith('/messages/send')){sends.push(JSON.parse(options.body));if(inflight)return new Promise((_,reject)=>{if(options.signal.aborted)reject(Error('aborted'));else options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});if(uncertain)throw Error('connection lost');return Response.json({id:'sent1',threadId:'t1'});}
  throw Error('Unexpected Gmail request: '+u.pathname);
 };
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false},async complete(messages){const last=messages.findLastIndex(m=>m.role==='user'),results=messages.slice(last+1).filter(m=>m.role==='tool');if(mode==='code' && !results.length)return {role:'assistant',content:null,tool_calls:[{id:'code',type:'function',function:{name:'code_mode',arguments:JSON.stringify({source:'await capabilities.gmail_read({messageId:"m1"}); return await capabilities.gmail_reply({messageId:"m1",to:"friend@example.test",subject:"Synthetic subject",body:"Thank you!\\nSee you soon."});'})}}]};if(mode==='code' && results.length===1 && results[0].content.includes('ownerRevision'))return {role:'assistant',content:null,tool_calls:[{id:'code-revised',type:'function',function:{name:'code_mode',arguments:JSON.stringify({source:'return await capabilities.gmail_reply({messageId:"m1",to:"friend@example.test",subject:"Synthetic subject",body:"Thank you so much! I look forward to seeing you."});'})}}]};if(mode==='code')return {role:'assistant',content:'Finished.'};if(!results.length)return {role:'assistant',content:null,tool_calls:[{id:'read',type:'function',function:{name:'gmail_read',arguments:'{"messageId":"m1"}'}}]};if(results.length===1 && modifyAction)return {role:'assistant',content:null,tool_calls:[{id:'modify',type:'function',function:{name:'gmail_modify',arguments:JSON.stringify({messageId:'m1',action:modifyAction,...(modifyAction==='label'?{labelName:'Projects'}:{})})}}]};if(!modifyAction && (results.length===1 || (results.length===2 && results[1].content.includes('revision-requested'))))return {role:'assistant',content:null,tool_calls:[{id:results.length===1?'reply':'revised',type:'function',function:{name:'gmail_reply',arguments:JSON.stringify({messageId:'m1',to:'friend@example.test',subject:proposedSubject,body:results.length===1?proposedBody:'Thank you so much! I look forward to seeing you.'})}}]};return {role:'assistant',content:'Finished.'};}});
 const options={env:{},gmailRequest,slackTransport,providerFactory,gmailPollIntervalMs:3600000};let app=startInstance(path,0,options),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [response.status,await response.json()];};
 const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Reply agent',provider:'live',model:'fixture',toolMode:mode}))[1];
 const attempt=(await call('/api/plugins/gmail/start',token,{email:'owner@example.test',clientId:'client',clientSecret:'secret',sendEnabled,modifyEnabled}))[1],u=new URL(attempt.url),cb=new URL(u.searchParams.get('redirect_uri'));assert.equal(u.searchParams.get('scope').includes('gmail.send'),sendEnabled);assert.equal(u.searchParams.get('scope').includes('gmail.modify'),modifyEnabled);cb.searchParams.set('state',u.searchParams.get('state'));cb.searchParams.set('code','code');assert.equal((await fetch(cb)).status,200);
 for(const [route,body] of [['/api/plugins/gmail/access',{botId:bot.id,enabled:true}],['/api/plugins/gmail/enable',{}],['/api/plugins/gmail/model-access',{botId:bot.id,provider:'live',model:'fixture',enabled:true}],['/api/plugins/slack/connect',{appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id}],['/api/plugins/slack/access',{botId:bot.id,enabled:true}],['/api/plugins/slack/enable',{}]])assert.equal((await call(route,token,body))[0],200,route);
 await wait(()=>interact);const begin=async id=>{assert.equal((await call('/api/commands',token,{id,botId:bot.id,content:'Read the message and propose a reply'}))[0],200);return wait(async()=>{const p=posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_disclose') && !p.used);if(p)return p;const item=(await call('/api/commands/'+id,token))[1];if(item.state!=='pending')throw Error(JSON.stringify(item));return null;});};
 const click=async(post,actionId,override={})=>interact({eventId:'event-'+Math.random(),teamId:'T123',userId:'U123',channelId:'D123',messageTs:post.messageTs,actionId,value:post.buttons[0].value,...override});
 const restart=async()=>{await app.close();app=startInstance(path,0,options);port=await app.listen();await wait(()=>interact);};
 const beginSlack=async()=>{assert.equal((await call('/api/plugins/gmail/work-model-access',token,{botId:bot.id,provider:'live',model:'fixture',enabled:true}))[0],200);await receive({eventId:'EvReply',teamId:'T123',userId:'U123',channelId:'D123',messageTs:'77.1',text:modifyAction?`Read the message and propose ${modifyAction}`:'Read the message and propose a reply'});return wait(()=>posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_disclose')));};
 const holdRefresh=()=>{let entered,release;const started=new Promise(resolve=>{entered=resolve}),wait=new Promise(resolve=>{release=resolve});refreshGate={entered,wait};return {started,release:()=>{refreshGate=undefined;release();}};};
 const say=async(event)=>receive(event);
 return {dir,path,posts,sends,changes,call,token,bot,begin,beginSlack,click,say,restart,holdRefresh,setLabels:value=>{labels=value;},close:async()=>{await app.close();rmSync(dir,{recursive:true,force:true});}};
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

test('a longer reply is shown and sent without truncation',async()=>{
 const body='x'.repeat(2500),f=await setup({proposedBody:body});try{const q=await f.beginSlack();await f.click(q,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));assert.ok(proposal.text.endsWith(body));await f.click(proposal,'gmail_approve');await wait(()=>f.sends.length===1);const raw=Buffer.from(f.sends[0].raw,'base64url').toString();assert.equal(Buffer.from(raw.split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString(),body);}finally{await f.close();}
});

test('Slack approval applies each exact scoped Gmail inbox change once',async()=>{
 for(const [action,expected] of [['archive',{addLabelIds:[],removeLabelIds:['INBOX']}],['mark_read',{addLabelIds:[],removeLabelIds:['UNREAD']}],['label',{addLabelIds:['Label_1'],removeLabelIds:[]}]]){const f=await setup({modifyEnabled:true,modifyAction:action});try{
  const question=await f.beginSlack();assert.doesNotMatch(question.text,/friend|Synthetic|Projects/);await f.click(question,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));assert.match(proposal.text,/friend@example.test/);assert.match(proposal.text,/Synthetic subject/);assert.match(proposal.text,action==='label'?/Add label: Projects \(Label_1\)/:action==='archive'?/Archive \(remove INBOX label\)/:/Mark read \(remove UNREAD label\)/);
  await f.click(proposal,'gmail_approve',{userId:'U999'});await f.click(proposal,'gmail_approve',{messageTs:'stale'});assert.equal(f.changes.length,0);await Promise.all([f.click(proposal,'gmail_approve'),f.click(proposal,'gmail_approve')]);await wait(()=>f.changes.length===1);assert.deepEqual(f.changes[0],expected);await f.click(proposal,'gmail_approve');assert.equal(f.changes.length,1);
  if(action==='archive'){const id='slack-'+createHash('sha256').update(JSON.stringify(['T123','EvReply'])).digest('hex');await wait(async()=>{const work=(await f.call('/api/commands/'+id,f.token))[1];return work.state!=='pending'&&work;});assert.equal((await f.call('/api/commands',f.token,{id:'archive-again',botId:f.bot.id,content:'Read and archive again'}))[0],200);const q2=await wait(()=>f.posts.filter(p=>p.buttons?.some(b=>b.actionId==='gmail_disclose'))[1]);await f.click(q2,'gmail_disclose');const p2=await wait(()=>f.posts.filter(p=>p.buttons?.some(b=>b.actionId==='gmail_approve'))[1]);assert.equal(f.changes.length,1);await f.click(p2,'gmail_approve');await wait(()=>f.changes.length===2);}
 }finally{await f.close();}}
});

test('denied and revoked inbox changes cannot execute',async()=>{
 for(const operation of ['label','archive','mark_read'])for(const action of ['deny','revoke']){const f=await setup({modifyEnabled:true,modifyAction:operation});try{const q=await f.beginSlack();await f.click(q,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));if(action==='deny')await f.click(proposal,'gmail_deny');else await f.call('/api/plugins/gmail/access',f.token,{botId:f.bot.id,enabled:false});await f.click(proposal,'gmail_approve');await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.changes.length,0);}finally{await f.close();}}
});

test('an account without explicit inbox permission cannot modify Gmail',async()=>{
 const f=await setup({modifyEnabled:false,modifyAction:'archive'});try{assert.equal((await f.call('/api/commands',f.token,{id:'no-modify',botId:f.bot.id,content:'Read and archive the message'}))[0],200);await wait(async()=>{const item=(await f.call('/api/commands/no-modify',f.token))[1];return item.state!=='pending'&&item;});assert.equal(f.posts.some(p=>p.buttons),false);assert.equal(f.changes.length,0);}finally{await f.close();}
});

test('revoking Gmail access after approving an inbox change prevents dispatch',async()=>{
 const f=await setup({modifyEnabled:true,modifyAction:'archive'});let gate;try{const q=await f.beginSlack();await f.click(q,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));gate=f.holdRefresh();await f.click(proposal,'gmail_approve');await gate.started;await f.call('/api/plugins/gmail/access',f.token,{botId:f.bot.id,enabled:false});gate.release();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(f.changes.length,0);}finally{gate?.release();await f.close();}
});

test('a renamed Gmail label invalidates the approved label change before dispatch',async()=>{
 const f=await setup({modifyEnabled:true,modifyAction:'label'});try{const q=await f.beginSlack();await f.click(q,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));f.setLabels([{id:'Label_1',name:'Renamed',type:'user'}]);await f.click(proposal,'gmail_approve');const id='slack-'+createHash('sha256').update(JSON.stringify(['T123','EvReply'])).digest('hex');await wait(async()=>{const work=(await f.call('/api/commands/'+id,f.token))[1];return work.state!=='pending'&&work;});assert.equal(f.changes.length,0);}finally{await f.close();}
});

test('in-flight inbox change is uncertain after restart and never replayed',async()=>{
 const f=await setup({modifyEnabled:true,modifyAction:'mark_read',inflightModify:true});try{const q=await f.beginSlack();await f.click(q,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));await f.click(proposal,'gmail_approve');await wait(()=>f.changes.length===1);await f.restart();await f.click(proposal,'gmail_approve');assert.equal(f.changes.length,1);const id='slack-'+createHash('sha256').update(JSON.stringify(['T123','EvReply'])).digest('hex'),work=(await f.call('/api/commands/'+id,f.token))[1];assert.equal(work.gmailReplies[0].state,'uncertain');assert.equal(work.workActions.find(a=>a.summary==='Apply approved Gmail inbox change').state,'uncertain');const [item]=(await f.call('/api/plugins/gmail/uncertain',f.token))[1];assert.equal(item.effect.action,'mark_read');assert.equal(item.intact,true);assert.notEqual((await f.call('/api/plugins/gmail/reconcile',f.token,{actionId:item.actionId,fingerprint:item.fingerprint,outcome:'not-sent'}))[0],200);assert.equal((await f.call('/api/plugins/gmail/reconcile-change',f.token,{actionId:item.actionId,fingerprint:item.fingerprint,outcome:'not-applied'}))[0],200);assert.equal((await f.call('/api/plugins/gmail/uncertain',f.token))[1].length,0);assert.equal(f.changes.length,1);}finally{await f.close();}
});

test('requesting a revision in Slack invalidates the original and requires fresh approval',async()=>{
 const f=await setup();try{
  const first=await f.beginSlack();await f.click(first,'gmail_disclose');const original=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_revise')));await f.click(original,'gmail_revise');await wait(()=>f.posts.find(p=>p.text.startsWith('Reply in this thread')));
  await f.click(original,'gmail_approve');await f.say({eventId:'BadRevision',teamId:'T123',userId:'U999',channelId:'D123',threadTs:'77.1',messageTs:'77.2',text:'Make it warmer'});assert.equal(f.sends.length,0);
  const direction={eventId:'Revision',teamId:'T123',userId:'U123',channelId:'D123',threadTs:'77.1',messageTs:'77.3',text:'Make it warmer'};await f.say(direction);await f.say(direction);
  const second=await wait(()=>f.posts.filter(p=>p.buttons?.some(b=>b.actionId==='gmail_disclose'))[1]);await f.click(second,'gmail_disclose');const revised=await wait(()=>f.posts.filter(p=>p.buttons?.some(b=>b.actionId==='gmail_approve'))[1]);assert.match(revised.text,/Thank you so much/);await f.click(original,'gmail_approve');assert.equal(f.sends.length,0);await f.click(revised,'gmail_approve');await wait(()=>f.sends.length===1);
 }finally{await f.close();}
});

test('Code Mode can read and propose through the same approval boundary',async()=>{
 const f=await setup({mode:'code'});try{const question=await f.begin('reply-code');await f.click(question,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));await f.click(proposal,'gmail_approve');await wait(()=>f.sends.length===1);}finally{await f.close();}
});

test('Code Mode receives owner revision direction and proposes again',async()=>{
 const f=await setup({mode:'code'});try{const question=await f.begin('code-revision');await f.click(question,'gmail_disclose');const proposal=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_revise')));await f.click(proposal,'gmail_revise');await wait(()=>f.posts.find(p=>p.text.startsWith('Reply in this thread')));await f.say({eventId:'CodeRevision',teamId:'T123',userId:'U123',channelId:'D123',threadTs:proposal.messageTs,messageTs:'80.1',text:'Make it warmer'});const question2=await wait(()=>f.posts.filter(p=>p.buttons?.some(b=>b.actionId==='gmail_disclose'))[1]);await f.click(question2,'gmail_disclose');const revised=await wait(()=>f.posts.filter(p=>p.buttons?.some(b=>b.actionId==='gmail_approve'))[1]);assert.match(revised.text,/Thank you so much/);await f.click(revised,'gmail_approve');await wait(()=>f.sends.length===1);}finally{await f.close();}
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
  const [visible]= (await f.call('/api/plugins/gmail/uncertain',f.token))[1];assert.equal(visible.intact,true);assert.equal(visible.effect.to,'friend@example.test');assert.equal(visible.effect.body,'Thank you!\nSee you soon.');
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
