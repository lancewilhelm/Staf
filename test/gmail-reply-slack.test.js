import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';
import {Instance} from '../dist/instance.js';
import {ActionJournal} from '../dist/action-journal.js';
import {SlackRateLimited} from '../dist/slack.js';

const wait=async fn=>{for(let i=0;i<700;i++){const v=await fn();if(v)return v;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};

async function setup({uncertain=false,inflight=false,sendEnabled=true,modifyEnabled=false,modifyAction,uncertainModify=false,inflightModify=false,failAssessment=false,rateAssessment=false,digestAssessment=false,postHook,uniqueSummaries=false,privateAssessment=false,distinctSender=false,mode='direct',proposedSubject='Synthetic subject',proposedBody='Thank you!\nSee you soon.'}={}) {
 const dir=mkdtempSync(join(tmpdir(),'staf-reply-')),path=join(dir,'db'),posts=[],sends=[],changes=[],assessed=[],rateAttempts=[];let interact,receive,sequence=0,assessmentFailures=Number(failAssessment),rateCount=Number(rateAssessment),clock=1000000,refreshGate,historyGate,arrivals=[],history=10,evidence=new Map(),labels=[{id:'Label_1',name:'Projects',type:'user'}];
 const slackTransport={identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,_status,interactions)=>{receive=handler;interact=interactions;return ()=>{interact=undefined;receive=undefined}},post:async(_tokens,message)=>{if(postHook)await postHook(message);if(message.text.startsWith('New Gmail candidate:') || message.text.startsWith('Gmail digest:')){rateAttempts.push(message);if(rateCount>0){rateCount--;throw new SlackRateLimited(1500);}}const messageTs=String(++sequence)+'.1';posts.push({...message,messageTs});return {messageTs};}};
 const gmailRequest=async(url,options={})=>{
  const u=new URL(url);
  if(u.hostname==='oauth2.googleapis.com'){if(refreshGate && String(options.body).includes('grant_type=refresh_token')){refreshGate.entered();await refreshGate.wait;}return Response.json({access_token:'access',refresh_token:'refresh',scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify',token_type:'Bearer'});}
  if(u.pathname.endsWith('/profile'))return Response.json({emailAddress:'owner@example.test',historyId:'10'});
  if(u.pathname.endsWith('/history')){const batch=arrivals;arrivals=[];const id=String(++history);for(const message of batch)evidence.set(message,id);if(historyGate){historyGate.entered();await historyGate.wait;}return Response.json({historyId:id,history:batch.map(message=>({id,messagesAdded:[{message:{id:message}}]}))});}
  if(u.searchParams.get('fields')==='id,historyId,labelIds'){const id=u.pathname.split('/').at(-1);if(id==='unavailable')return new Response('',{status:404});const labelIds={sent:['SENT'],draft:['DRAFT'],spam:['SPAM'],archive:['IMPORTANT'],moved:['INBOX'],'moved-out':['IMPORTANT'],missing:undefined}[id]??(id==='missing'?undefined:['INBOX']);return Response.json({id,historyId:['moved','moved-out'].includes(id)?'999':evidence.get(id),...(labelIds?{labelIds}:{})});}
  if(u.pathname.endsWith('/messages/m1') || u.pathname.endsWith('/messages/m2') || u.pathname.endsWith('/messages/m3') || u.pathname.endsWith('/messages/moved'))return Response.json({id:u.pathname.split('/').at(-1),threadId:'t1',payload:{mimeType:'text/plain',headers:[{name:'From',value:distinctSender && u.pathname.endsWith('/m3')?'other@example.test':'friend@example.test'},{name:'Subject',value:'Synthetic subject'},{name:'Message-ID',value:'<original@example.test>'}],body:{data:Buffer.from('private synthetic message').toString('base64url')}}});
  if(u.pathname.endsWith('/labels'))return Response.json({labels});
  if(u.pathname.endsWith('/messages/m1/modify')){changes.push(JSON.parse(options.body));if(inflightModify)return new Promise((_,reject)=>{if(options.signal.aborted)reject(Error('aborted'));else options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});if(uncertainModify)throw Error('connection lost');return Response.json({id:'m1'});}
  if(u.pathname.endsWith('/messages/send')){sends.push(JSON.parse(options.body));if(inflight)return new Promise((_,reject)=>{if(options.signal.aborted)reject(Error('aborted'));else options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});if(uncertain)throw Error('connection lost');return Response.json({id:'sent1',threadId:'t1'});}
  throw Error('Unexpected Gmail request: '+u.pathname);
 };
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false},async complete(messages,_tools,options){if(options.currentUserInput?.includes('Evaluate exactly Gmail message')){const messageId=/Gmail message ([\w-]+)/.exec(options.currentUserInput)?.[1];if(!messages.some(m=>m.role==='tool')){assessed.push(messageId);return {role:'assistant',content:null,tool_calls:[{id:'inbox-read',type:'function',function:{name:'gmail_read',arguments:JSON.stringify({messageId})}}]};}if(assessmentFailures>0){assessmentFailures--;return {role:'assistant',content:'invalid assessment'};}return {role:'assistant',content:JSON.stringify({relevance:'relevant',sensitivity:privateAssessment?'sensitive':'non-sensitive',urgency:(Array.isArray(digestAssessment)?digestAssessment.includes(messageId):digestAssessment)?'digest':'urgent',summary:uniqueSummaries?`Summary ${messageId}`:'A friend sent a synthetic invitation.'})};}const last=messages.findLastIndex(m=>m.role==='user'),results=messages.slice(last+1).filter(m=>m.role==='tool');if(mode==='code' && !results.length)return {role:'assistant',content:null,tool_calls:[{id:'code',type:'function',function:{name:'code_mode',arguments:JSON.stringify({source:'await capabilities.gmail_read({messageId:"m1"}); return await capabilities.gmail_reply({messageId:"m1",to:"friend@example.test",subject:"Synthetic subject",body:"Thank you!\\nSee you soon."});'})}}]};if(mode==='code' && results.length===1 && results[0].content.includes('ownerRevision'))return {role:'assistant',content:null,tool_calls:[{id:'code-revised',type:'function',function:{name:'code_mode',arguments:JSON.stringify({source:'return await capabilities.gmail_reply({messageId:"m1",to:"friend@example.test",subject:"Synthetic subject",body:"Thank you so much! I look forward to seeing you."});'})}}]};if(mode==='code')return {role:'assistant',content:'Finished.'};if(!results.length)return {role:'assistant',content:null,tool_calls:[{id:'read',type:'function',function:{name:'gmail_read',arguments:'{"messageId":"m1"}'}}]};if(modifyAction && (results.length===1 || (results.length===2 && results[1].content.includes('revision-requested'))))return {role:'assistant',content:null,tool_calls:[{id:results.length===1?'modify':'modify-revised',type:'function',function:{name:'gmail_modify',arguments:JSON.stringify({messageId:'m1',action:results.length===1?modifyAction:'mark_read',...(results.length===1 && modifyAction==='label'?{labelName:'Projects'}:{})})}}]};if(!modifyAction && (results.length===1 || (results.length===2 && results[1].content.includes('revision-requested'))))return {role:'assistant',content:null,tool_calls:[{id:results.length===1?'reply':'revised',type:'function',function:{name:'gmail_reply',arguments:JSON.stringify({messageId:'m1',to:'friend@example.test',subject:proposedSubject,body:results.length===1?proposedBody:'Thank you so much! I look forward to seeing you.'})}}]};return {role:'assistant',content:'Finished.'};}});
 const options={env:{},gmailRequest,slackTransport,providerFactory,gmailPollIntervalMs:3600000,inboxNow:()=>clock};let app=startInstance(path,0,options),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [response.status,await response.json()];};
 const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Reply agent',provider:'live',model:'fixture',toolMode:mode}))[1];
 const attempt=(await call('/api/plugins/gmail/start',token,{confirm:true,email:'owner@example.test',clientId:'client',clientSecret:'secret',sendEnabled,modifyEnabled}))[1],u=new URL(attempt.url),cb=new URL(u.searchParams.get('redirect_uri'));assert.equal(u.searchParams.get('scope').includes('gmail.send'),sendEnabled);assert.equal(u.searchParams.get('scope').includes('gmail.modify'),modifyEnabled);cb.searchParams.set('state',u.searchParams.get('state'));cb.searchParams.set('code','code');assert.equal((await fetch(cb)).status,200);
 for(const [route,body] of [['/api/plugins/gmail/access',{botId:bot.id,enabled:true}],['/api/plugins/gmail/enable',{}],['/api/plugins/gmail/model-access',{botId:bot.id,provider:'live',model:'fixture',enabled:true}],['/api/plugins/slack/connect',{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id}],['/api/plugins/slack/access',{botId:bot.id,enabled:true}],['/api/plugins/slack/enable',{}]])assert.equal((await call(route,token,body))[0],200,route);
 await wait(()=>interact);const begin=async id=>{assert.equal((await call('/api/commands',token,{id,botId:bot.id,content:'Read the message and propose a reply'}))[0],200);return wait(async()=>{const p=posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_disclose') && !p.used);if(p)return p;const item=(await call('/api/commands/'+id,token))[1];if(item.state!=='pending')throw Error(JSON.stringify(item));return null;});};
 const click=async(post,actionId,override={})=>interact({eventId:'event-'+Math.random(),teamId:'T123',userId:'U123',channelId:'D123',messageTs:post.messageTs,actionId,value:post.buttons[0].value,...override});
 const restart=async()=>{await app.close();app=startInstance(path,0,options);port=await app.listen();await wait(()=>interact);};
 const mutateDb=async(fn)=>{await app.close();const db=new DatabaseSync(path);try{fn(db);}finally{db.close();}app=startInstance(path,0,options);port=await app.listen();await wait(()=>interact);};
 const beginSlack=async()=>{assert.equal((await call('/api/plugins/gmail/work-model-access',token,{botId:bot.id,provider:'live',model:'fixture',enabled:true}))[0],200);await receive({eventId:'EvReply',teamId:'T123',userId:'U123',channelId:'D123',messageTs:'77.1',text:modifyAction?`Read the message and propose ${modifyAction}`:'Read the message and propose a reply'});return wait(()=>posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_disclose')));};
 const holdHistory=()=>{let entered,release;const started=new Promise(resolve=>{entered=resolve}),wait=new Promise(resolve=>{release=resolve});historyGate={entered,wait};return {started,release:()=>{historyGate=undefined;release();}};};
 const holdRefresh=()=>{let entered,release;const started=new Promise(resolve=>{entered=resolve}),wait=new Promise(resolve=>{release=resolve});refreshGate={entered,wait};return {started,release:()=>{refreshGate=undefined;release();}};};
 const say=async(event)=>receive(event);
 return {dir,path,posts,sends,changes,assessed,rateAttempts,call,token,bot,begin,beginSlack,click,say,restart,mutateDb,holdRefresh,holdHistory,setArrivals:value=>{arrivals=value;},advanceClock:ms=>{clock+=ms;},setLabels:value=>{labels=value;},close:async()=>{await app.close();rmSync(dir,{recursive:true,force:true});}};
}


test('initial scan and concurrent arrivals are handed off once, with uncertain mailbox additions held for review',async()=>{
 const f=await setup();let gate;try{
  assert.equal((await f.call('/api/plugins/gmail/work-model-access',f.token,{botId:f.bot.id,provider:'live',model:'fixture',enabled:true}))[0],200);
  const gmail=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail'),{name,...target}=gmail.inboxTarget;
  f.setArrivals(['m1','sent','draft','spam','archive','moved','moved-out','missing','unavailable']);gate=f.holdHistory();
  const enabling=f.call('/api/plugins/gmail/inbox-preferences',f.token,{preferences:{enabled:true,attention:'Invitations matter',sensitiveTerms:[]},revision:null,target,confirmModelAccess:true});
  await gate.started;assert.deepEqual(f.assessed,[]);f.setArrivals(['m2']);gate.release();assert.equal((await enabling)[0],200);
  await wait(()=>f.posts.filter(p=>p.text.includes('A friend sent a synthetic invitation.')).length===1);
  assert.equal((await f.call('/api/plugins/gmail/poll',f.token,{}))[0],200);
  await wait(()=>f.posts.filter(p=>p.text.includes('A friend sent a synthetic invitation.')).length===2);
  let states=Object.fromEntries((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail').arrivals.map(item=>[item.messageId,item.inbox]));
  assert.deepEqual(states,{m1:'yes',sent:'no',draft:'no',spam:'no',archive:'no',moved:'unknown','moved-out':'unknown',missing:'unknown',unavailable:'unknown',m2:'yes'});
  assert.deepEqual([...f.assessed].sort(),['m1','m2']);
  await f.restart();f.setArrivals(['m1','sent','moved','m2']);assert.equal((await f.call('/api/plugins/gmail/poll',f.token,{}))[0],200);
  states=Object.fromEntries((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail').arrivals.map(item=>[item.messageId,item.inbox]));assert.equal(states.moved,'unknown');assert.equal(states.sent,'no');
  assert.deepEqual([...f.assessed].sort(),['m1','m2']);assert.equal(f.posts.filter(p=>p.text.includes('A friend sent a synthetic invitation.')).length,2);
  let current=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail');const prefs={enabled:false,attention:'Invitations matter',sensitiveTerms:[]};
  assert.equal((await f.call('/api/plugins/gmail/inbox-preferences',f.token,{preferences:prefs,revision:current.inboxPreferences.revision}))[0],200);
  f.setArrivals(['m3']);assert.equal((await f.call('/api/plugins/gmail/poll',f.token,{}))[0],200);assert.deepEqual([...f.assessed].sort(),['m1','m2']);
  current=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail');const {name:ignored,...resumedTarget}=current.inboxTarget;
  assert.equal((await f.call('/api/plugins/gmail/inbox-preferences',f.token,{preferences:{...prefs,enabled:true},revision:current.inboxPreferences.revision,target:resumedTarget,confirmModelAccess:true}))[0],200);
  await wait(()=>f.posts.filter(p=>p.text.includes('A friend sent a synthetic invitation.')).length===3);assert.deepEqual([...f.assessed].sort(),['m1','m2','m3']);
 }finally{gate?.release();await f.close();}
});

test('revoking Gmail during the enablement scan prevents handoff and model disclosure',async()=>{
 const f=await setup();let gate;try{
  assert.equal((await f.call('/api/plugins/gmail/work-model-access',f.token,{botId:f.bot.id,provider:'live',model:'fixture',enabled:true}))[0],200);
  const g=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail'),{name,...target}=g.inboxTarget;
  f.setArrivals(['m1']);gate=f.holdHistory();const enabling=f.call('/api/plugins/gmail/inbox-preferences',f.token,{preferences:{enabled:true,attention:'',sensitiveTerms:[]},revision:null,target,confirmModelAccess:true});
  await gate.started;assert.equal((await f.call('/api/plugins/gmail/access',f.token,{botId:f.bot.id,enabled:false}))[0],200);gate.release();assert.notEqual((await enabling)[0],200);
  const after=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail');assert.equal(after.inboxPreferences,null);assert.deepEqual(f.assessed,[]);assert.equal(f.posts.length,0);
 }finally{gate?.release();await f.close();}
});

test('new mail leads from an inbox update through revised Slack approval and persists after restart',async()=>{
 const f=await setup();try{
  assert.equal((await f.call('/api/plugins/gmail/work-model-access',f.token,{botId:f.bot.id,provider:'live',model:'fixture',enabled:true}))[0],200);
  const gmail=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail');
  const {name,...target}=gmail.inboxTarget;
  assert.equal((await f.call('/api/plugins/gmail/inbox-preferences',f.token,{preferences:{enabled:true,attention:'Invitations matter',sensitiveTerms:[]},revision:null,target,confirmModelAccess:true}))[0],200);
  assert.equal(f.posts.length,0);
  f.setArrivals(['m1','m1']);assert.equal((await f.call('/api/plugins/gmail/poll',f.token,{}))[0],200);
  const update=await wait(()=>f.posts.find(p=>p.text.includes('A friend sent a synthetic invitation.')));
  assert.equal(update.channel,'D123');assert.equal(f.posts.filter(p=>p.text.includes('A friend sent a synthetic invitation.')).length,1);
  await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.some(item=>item.state==='delivered'));
  await f.say({eventId:'OwnerFeedback',teamId:'T123',userId:'U123',channelId:'D123',threadTs:update.messageTs,messageTs:'80.0',text:'This should have been less urgent'});
  await wait(()=>f.posts.find(p=>p.threadTs===update.messageTs && p.text.includes('I noted your correction')));
  await f.say({eventId:'OwnerReply',teamId:'T123',userId:'U123',channelId:'D123',threadTs:update.messageTs,messageTs:'80.1',text:'Read the message and propose a reply'});
  const question=await wait(async()=>{const p=f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_disclose'));if(p)return p;const id='slack-'+createHash('sha256').update(JSON.stringify(['T123','OwnerReply'])).digest('hex');const [status,item]=await f.call('/api/commands/'+id,f.token);if(status===200 && item.state!=='pending')throw Error(JSON.stringify({item,posts:f.posts}));return null;});assert.equal(question.threadTs,update.messageTs);
  await f.click(question,'gmail_disclose');const original=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_revise')));
  await f.click(original,'gmail_revise');await wait(()=>f.posts.find(p=>p.text.startsWith('Reply in this thread')));
  await f.say({eventId:'OwnerRevision',teamId:'T123',userId:'U123',channelId:'D123',threadTs:update.messageTs,messageTs:'80.2',text:'Make it warmer'});
  const second=await wait(()=>f.posts.filter(p=>p.buttons?.some(b=>b.actionId==='gmail_disclose'))[1]);await f.click(second,'gmail_disclose');
  const revised=await wait(()=>f.posts.filter(p=>p.buttons?.some(b=>b.actionId==='gmail_approve'))[1]);assert.match(revised.text,/To: friend@example.test/);assert.match(revised.text,/Thank you so much/);
  await f.click(original,'gmail_approve');assert.equal(f.sends.length,0);await f.click(revised,'gmail_approve');await wait(()=>f.sends.length===1);
  const raw=Buffer.from(f.sends[0].raw,'base64url').toString();assert.equal(Buffer.from(raw.split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString(),'Thank you so much! I look forward to seeing you.');
  const id='slack-'+createHash('sha256').update(JSON.stringify(['T123','OwnerReply'])).digest('hex');
  await wait(async()=>{const item=(await f.call('/api/commands/'+id,f.token))[1];return item.state!=='pending'&&item;});
  await f.restart();const persisted=(await f.call('/api/commands/'+id,f.token))[1];assert.equal(persisted.gmailReplies.at(-1).state,'succeeded');
  await f.click(revised,'gmail_approve');f.setArrivals(['m1']);await f.call('/api/plugins/gmail/poll',f.token,{});assert.equal(f.sends.length,1);assert.equal(f.posts.filter(p=>p.text.includes('A friend sent a synthetic invitation.')).length,1);
 }finally{await f.close();}
});

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

test('revising an inbox change requires a fresh exact approval',async()=>{
 const f=await setup({modifyEnabled:true,modifyAction:'archive'});try {
  const question=await f.beginSlack();await f.click(question,'gmail_disclose');const first=await wait(()=>f.posts.find(p=>p.buttons?.some(b=>b.actionId==='gmail_approve')));
  assert.ok(first.buttons.some(b=>b.actionId==='gmail_revise'));await f.click(first,'gmail_revise');await wait(()=>f.posts.find(p=>p.text.startsWith('Reply in this thread')));
  await f.say({eventId:'revision-change',teamId:'T123',userId:'U123',channelId:'D123',threadTs:'77.1',messageTs:'80.2',text:'Mark it read instead'});
  const secondQuestion=await wait(()=>f.posts.filter(p=>p.buttons?.some(b=>b.actionId==='gmail_disclose'))[1]);await f.click(secondQuestion,'gmail_disclose');
  const second=await wait(()=>f.posts.filter(p=>p.buttons?.some(b=>b.actionId==='gmail_approve'))[1]);assert.match(second.text,/Mark read/);
  await f.click(first,'gmail_approve');assert.equal(f.changes.length,0);await f.click(second,'gmail_approve');await wait(()=>f.changes.length===1);assert.deepEqual(f.changes[0],{addLabelIds:[],removeLabelIds:['UNREAD']});
 }finally{await f.close();}
});

test('owner can assess unknown membership and retry a failed evaluation without duplicate delivery',async()=>{
 const f=await setup({failAssessment:true});try {
  await f.call('/api/plugins/gmail/work-model-access',f.token,{botId:f.bot.id,provider:'live',model:'fixture',enabled:true});
  let g=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail'),{name,...target}=g.inboxTarget;
  await f.call('/api/plugins/gmail/inbox-preferences',f.token,{preferences:{enabled:true,attention:'',sensitiveTerms:[]},revision:null,target,confirmModelAccess:true});
  f.setArrivals(['moved']);await f.call('/api/plugins/gmail/poll',f.token,{});g=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail');assert.equal(g.arrivals.find(a=>a.messageId==='moved').inbox,'unknown');assert.deepEqual(f.assessed,[]);
  assert.equal((await f.call('/api/plugins/gmail/review-candidate',f.token,{messageId:'moved',revision:g.inboxPreferences.revision,confirm:true}))[0],200);
  const failed=await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.find(i=>i.state==='failed'));
  assert.equal((await f.call('/api/plugins/gmail/retry-evaluation',f.token,{attemptId:failed.attemptId,revision:g.inboxPreferences.revision,confirm:true}))[0],200);
  const question=await wait(()=>f.posts.find(p=>p.text.includes('may need private handling')));assert.doesNotMatch(question.text,/friend|invitation|synthetic/);assert.equal(f.posts.filter(p=>p.text.includes('A friend sent')).length,0);
  await f.say({eventId:'approve-unknown',teamId:'T123',userId:'U123',channelId:'D123',threadTs:question.messageTs,text:'yes'});await wait(()=>f.posts.filter(p=>p.text.includes('A friend sent')).length===1);
  await f.restart();await new Promise(resolve=>setTimeout(resolve,400));assert.equal(f.posts.filter(p=>p.text.includes('A friend sent')).length,1);assert.equal((await f.call('/api/plugins/gmail/retry-evaluation',f.token,{attemptId:failed.attemptId,revision:g.inboxPreferences.revision,confirm:true}))[0],409);
 }finally{await f.close();}
});

test('rate-limited inbox delivery waits across restart and checks revocation',async()=>{
 const f=await setup({rateAssessment:true});try {
  await f.call('/api/plugins/gmail/work-model-access',f.token,{botId:f.bot.id,provider:'live',model:'fixture',enabled:true});const g=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail'),{name,...target}=g.inboxTarget;
  await f.call('/api/plugins/gmail/inbox-preferences',f.token,{preferences:{enabled:true,attention:'',sensitiveTerms:[]},revision:null,target,confirmModelAccess:true});
  f.setArrivals(['m1']);await f.call('/api/plugins/gmail/poll',f.token,{});await wait(()=>f.rateAttempts.length===1);await f.restart();
  await new Promise(resolve=>setTimeout(resolve,350));assert.equal(f.rateAttempts.length,1);assert.ok(!f.posts.some(p=>p.text.startsWith('New Gmail candidate:')));
  await f.call('/api/plugins/gmail/access',f.token,{botId:f.bot.id,enabled:false});await new Promise(resolve=>setTimeout(resolve,1800));assert.equal(f.rateAttempts.length,1);
 }finally{await f.close();}
});

for(const digest of [false,true])test(`rate-limited ${digest?'digest':'individual'} delivery retries once after restart`,async()=>{
 const f=await setup({rateAssessment:true,digestAssessment:digest});try {
  await f.call('/api/plugins/gmail/work-model-access',f.token,{botId:f.bot.id,provider:'live',model:'fixture',enabled:true});const g=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail'),{name,...target}=g.inboxTarget;
  await f.call('/api/plugins/gmail/inbox-preferences',f.token,{preferences:{enabled:true,attention:'',sensitiveTerms:[],digestMinutes:1},revision:null,target,confirmModelAccess:true});
  f.setArrivals(['m1']);await f.call('/api/plugins/gmail/poll',f.token,{});if(digest){await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.some(i=>i.state==='digest_pending'));f.advanceClock(60001);}
  await wait(()=>f.rateAttempts.length===1);await f.restart();await new Promise(resolve=>setTimeout(resolve,350));assert.equal(f.rateAttempts.length,1);
  await wait(()=>f.rateAttempts.length===2);await new Promise(resolve=>setTimeout(resolve,300));assert.equal(f.rateAttempts.length,2);assert.equal(f.posts.filter(p=>p.text.includes('A friend sent a synthetic invitation.')).length,1);
 }finally{await f.close();}
});

async function enableTestInbox(f,prefs={enabled:true,attention:'',sensitiveTerms:[],digestMinutes:1}) {
 await f.call('/api/plugins/gmail/work-model-access',f.token,{botId:f.bot.id,provider:'live',model:'fixture',enabled:true});
 const g=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail'),{name,...target}=g.inboxTarget;assert.equal((await f.call('/api/plugins/gmail/inbox-preferences',f.token,{preferences:prefs,revision:null,target,confirmModelAccess:true}))[0],200);return prefs;
}
async function changeTestInbox(f,prefs){const g=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail'),{name,...target}=g.inboxTarget;return f.call('/api/plugins/gmail/inbox-preferences',f.token,{preferences:prefs,revision:g.inboxPreferences.revision,target,confirmModelAccess:true});}
test('compatible preference changes preserve corrections, while revocation blocks them',async()=>{
 const f=await setup({uniqueSummaries:true});try {
  let prefs=await enableTestInbox(f);f.setArrivals(['m1']);await f.call('/api/plugins/gmail/poll',f.token,{});const first=await wait(()=>f.posts.find(p=>p.text.includes('Summary m1')));
  prefs={...prefs,attention:'changed'};assert.equal((await changeTestInbox(f,prefs))[0],200);
  for(const [eventId,text] of [['sens','This is sensitive'],['urgent','This is urgent'],['not-sensitive','This is not sensitive']])await f.say({eventId,teamId:'T123',userId:'U123',channelId:'D123',threadTs:first.messageTs,text});
  await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.some(i=>i.correction==='not-sensitive' && i.sensitiveActive===1));
  f.setArrivals(['m2']);await f.call('/api/plugins/gmail/poll',f.token,{});await wait(()=>f.posts.some(p=>p.text.includes('may need private handling')));assert.ok(!f.posts.some(p=>p.text.includes('Summary m2')));
  await f.call('/api/plugins/gmail/access',f.token,{botId:f.bot.id,enabled:false});await f.say({eventId:'revoked-clear',teamId:'T123',userId:'U123',channelId:'D123',threadTs:first.messageTs,text:'Forget that correction'});
  assert.ok(((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.some(i=>i.correction==='not-sensitive' && i.sensitiveActive===1));
  await f.call('/api/plugins/gmail/access',f.token,{botId:f.bot.id,enabled:true});assert.equal((await changeTestInbox(f,prefs))[0],200);await f.say({eventId:'old-binding-after-reauthorize',teamId:'T123',userId:'U123',channelId:'D123',threadTs:first.messageTs,text:'Forget that correction'});
  assert.ok(((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.some(i=>i.correction==='not-sensitive' && i.sensitiveActive===1));
 }finally{await f.close();}
});
test('privacy edits and sender corrections during rejected individual delivery require a delayed private clarification',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let held=false;
 const f=await setup({uniqueSummaries:true,postHook:async m=>{if(m.text.includes('Summary m2')&&!held){held=true;entered();await gate;throw new SlackRateLimited(1200);}}});try {
  let prefs=await enableTestInbox(f);f.setArrivals(['m1']);await f.call('/api/plugins/gmail/poll',f.token,{});const first=await wait(()=>f.posts.find(p=>p.text.includes('Summary m1')));
  f.setArrivals(['m2']);await f.call('/api/plugins/gmail/poll',f.token,{});await started;await f.say({eventId:'sensitive-in-flight',teamId:'T123',userId:'U123',channelId:'D123',threadTs:first.messageTs,text:'This is sensitive'});
  prefs={...prefs,sensitiveTerms:['appointment']};assert.equal((await changeTestInbox(f,prefs))[0],200);release();await new Promise(r=>setTimeout(r,400));assert.ok(!f.posts.some(p=>p.text.includes('may need private handling')));
  await wait(()=>f.posts.some(p=>p.text.includes('may need private handling')));assert.ok(!f.posts.some(p=>p.text.includes('Summary m2')));
 }finally{release();await f.close();}
});
test('a rejected in-flight digest separates every member and retains the rate-limit deadline',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let held=false;
 const f=await setup({uniqueSummaries:true,digestAssessment:['m2','m3'],distinctSender:true,postHook:async m=>{if(m.text.startsWith('Gmail digest:')&&!held){held=true;entered();await gate;throw new SlackRateLimited(1200);}}});try {
  await enableTestInbox(f);f.setArrivals(['m1']);await f.call('/api/plugins/gmail/poll',f.token,{});const first=await wait(()=>f.posts.find(p=>p.text.includes('Summary m1')));
  f.setArrivals(['m2','m3']);await f.call('/api/plugins/gmail/poll',f.token,{});await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.filter(i=>i.state==='digest_pending').length===2);f.advanceClock(60001);await started;
  await f.say({eventId:'digest-sensitive',teamId:'T123',userId:'U123',channelId:'D123',threadTs:first.messageTs,text:'This is sensitive'});release();await new Promise(r=>setTimeout(r,400));assert.ok(!f.posts.some(p=>p.text.includes('may need private handling')));assert.ok(!f.posts.some(p=>p.text.startsWith('Gmail digest:')));
  await wait(()=>f.posts.some(p=>p.text.includes('may need private handling')));f.advanceClock(60001);const digest=await wait(()=>f.posts.find(p=>p.text.startsWith('Gmail digest:')));assert.match(digest.text,/Summary m3/);assert.doesNotMatch(digest.text,/Summary m2/);
 }finally{release();await f.close();}
});
test('a confirmed private question remains usable after a privacy edit during its delivery',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let held=false;
 const f=await setup({uniqueSummaries:true,privateAssessment:true,postHook:async m=>{if(m.text.includes('may need private handling')&&!held){held=true;entered();await gate;}}});try {
  let prefs=await enableTestInbox(f);f.setArrivals(['m1']);await f.call('/api/plugins/gmail/poll',f.token,{});await started;prefs={...prefs,sensitiveTerms:['private']};assert.equal((await changeTestInbox(f,prefs))[0],200);release();
  const question=await wait(()=>f.posts.find(p=>p.text.includes('may need private handling')));await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.some(i=>i.state==='awaiting'));
  await f.say({eventId:'answer-after-edit',teamId:'T123',userId:'U123',channelId:'D123',threadTs:question.messageTs,text:'yes'});await wait(()=>f.posts.some(p=>p.text.includes('Summary m1')));
 }finally{release();await f.close();}
});

test('migrated stale digest members are individually reassessed with private clarification',async()=>{
 const f=await setup({uniqueSummaries:true});try {
  await enableTestInbox(f);await f.mutateDb(db=>{for(const id of ['m1','m2']){db.prepare('INSERT INTO gmail_arrivals VALUES (?,?)').run('owner@example.test',id);db.prepare("INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state,summary) VALUES ('owner@example.test',?,1,?,'digest_batched',?)").run(id,'old-'+id,'old '+id);}db.prepare("INSERT INTO inbox_digest_batches VALUES ('old-batch',1,'pending','prior digest',NULL,0)").run();for(const id of ['m1','m2'])db.prepare('INSERT INTO inbox_digest_items VALUES (?,?)').run('old-batch','old-'+id);db.exec('DROP TABLE gmail_arrival_evidence; PRAGMA user_version=49');});
  let g=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail');assert.equal(g.inboxStatus.items.filter(i=>i.state==='stale').length,2);assert.equal(g.arrivals.find(a=>a.messageId==='m1').inbox,'unknown');
  for(const id of ['m1','m2'])assert.equal((await f.call('/api/plugins/gmail/review-candidate',f.token,{messageId:id,revision:g.inboxPreferences.revision,confirm:true}))[0],200);
  await wait(()=>f.posts.filter(p=>p.text.includes('may need private handling')).length===2);assert.ok(!f.posts.some(p=>p.text.includes('Summary m1')||p.text.includes('Summary m2')));
  await f.restart();await new Promise(r=>setTimeout(r,350));assert.equal(f.posts.filter(p=>p.text.includes('may need private handling')).length,2);
  await f.mutateDb(db=>{assert.equal(db.prepare("SELECT text FROM inbox_digest_batches WHERE id='old-batch'").get().text,'prior digest');assert.equal(db.prepare("SELECT count(*) AS n FROM inbox_digest_history WHERE batch_id='old-batch'").get().n,2);assert.equal(db.prepare('SELECT count(*) AS n FROM inbox_assessment_history').get().n,2);});
 }finally{await f.close();}
});
test('privacy change during a rejected digest keeps all members private after restart',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let held=false;
 const f=await setup({uniqueSummaries:true,digestAssessment:true,postHook:async m=>{if(m.text.startsWith('Gmail digest:')&&!held){held=true;entered();await gate;throw new SlackRateLimited(1500);}}});try {
  let prefs=await enableTestInbox(f);f.setArrivals(['m1','m2']);await f.call('/api/plugins/gmail/poll',f.token,{});await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.filter(i=>i.state==='digest_pending').length===2);f.advanceClock(60001);await started;
  prefs={...prefs,sensitiveTerms:['new private topic']};assert.equal((await changeTestInbox(f,prefs))[0],200);release();await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.filter(i=>i.state==='clarify').length===2);await f.restart();await new Promise(r=>setTimeout(r,300));assert.equal(f.posts.filter(p=>p.text.includes('may need private handling')).length,0);
  await wait(()=>f.posts.filter(p=>p.text.includes('may need private handling')).length===2);assert.ok(!f.posts.some(p=>p.text.includes('Summary m1')||p.text.includes('Summary m2')));
 }finally{release();await f.close();}
});
test('two-hour rejection deadline survives restart and is not shortened',async()=>{
 let refused=false;const f=await setup({uniqueSummaries:true,postHook:async m=>{if(m.text.includes('Summary m1')&&!refused){refused=true;throw new SlackRateLimited(7200000);}}});try {
  await enableTestInbox(f);const started=Date.now();f.setArrivals(['m1']);await f.call('/api/plugins/gmail/poll',f.token,{});await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.some(i=>i.state==='ready'));
  await f.mutateDb(db=>{assert.ok(db.prepare("SELECT retry_at FROM inbox_delivery_retry WHERE kind='item'").get().retry_at>=started+7200000);});await new Promise(r=>setTimeout(r,400));assert.ok(!f.posts.some(p=>p.text.includes('Summary m1')));
 }finally{await f.close();}
});
test('invalid rate-limit delay fails closed for owner review',async()=>{
 const f=await setup({uniqueSummaries:true,postHook:async m=>{if(m.text.includes('Summary m1'))throw new SlackRateLimited(null);}});try {
  await enableTestInbox(f);f.setArrivals(['m1']);await f.call('/api/plugins/gmail/poll',f.token,{});const item=await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.find(i=>i.state==='rate_limit_review'));
  await f.restart();await new Promise(r=>setTimeout(r,350));assert.ok(!f.posts.some(p=>p.text.includes('Summary m1')));const r=await f.call('/api/plugins/gmail/resolve-delivery',f.token,{kind:'item',id:item.attemptId,decision:'resend',expectedText:item.preview,confirm:true});assert.notEqual(r[0],200);
 }finally{await f.close();}
});
test('a rate-limited digest cannot replay after Gmail authority is revoked',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let held=false;
 const f=await setup({uniqueSummaries:true,digestAssessment:true,postHook:async m=>{if(m.text.startsWith('Gmail digest:')&&!held){held=true;entered();await gate;throw new SlackRateLimited(7200000);}}});try {
  await enableTestInbox(f);f.setArrivals(['m1','m2']);await f.call('/api/plugins/gmail/poll',f.token,{});await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.filter(i=>i.state==='digest_pending').length===2);f.advanceClock(60001);await started;
  await f.call('/api/plugins/gmail/access',f.token,{botId:f.bot.id,enabled:false});release();const g=await wait(async()=>{const x=(await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail');return x.inboxStatus.items.filter(i=>i.state==='stale').length===2 && x;});
  assert.notEqual((await f.call('/api/plugins/gmail/retry-evaluation',f.token,{attemptId:g.inboxStatus.items[0].attemptId,revision:g.inboxPreferences.revision,confirm:true}))[0],200);
  await f.mutateDb(db=>{assert.equal(db.prepare("SELECT count(*) AS n FROM inbox_digest_batches WHERE state='stale'").get().n,1);assert.ok(db.prepare("SELECT retry_at FROM inbox_delivery_retry WHERE kind='digest'").get().retry_at>Date.now()+7190000);});await new Promise(r=>setTimeout(r,350));assert.ok(!f.posts.some(p=>p.text.startsWith('Gmail digest:')));
 }finally{release();await f.close();}
});
test('a successful in-flight digest remains correctable after a privacy edit',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let held=false;
 const f=await setup({uniqueSummaries:true,digestAssessment:['m1','m2'],postHook:async m=>{if(m.text.startsWith('Gmail digest:')&&!held){held=true;entered();await gate;}}});try {
  let prefs=await enableTestInbox(f);f.setArrivals(['m1','m2']);await f.call('/api/plugins/gmail/poll',f.token,{});await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.filter(i=>i.state==='digest_pending').length===2);f.advanceClock(60001);await started;
  prefs={...prefs,sensitiveTerms:['private']};assert.equal((await changeTestInbox(f,prefs))[0],200);release();const digest=await wait(()=>f.posts.find(p=>p.text.startsWith('Gmail digest:')));await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.filter(i=>i.state==='delivered').length===2);
  await f.say({eventId:'digest-after-edit',teamId:'T123',userId:'U123',channelId:'D123',threadTs:digest.messageTs,text:'The first item is sensitive'});await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.some(i=>i.sensitiveActive===1));
  f.setArrivals(['m3']);await f.call('/api/plugins/gmail/poll',f.token,{});await wait(()=>f.posts.some(p=>p.text.includes('may need private handling')));assert.ok(!f.posts.some(p=>p.text.includes('Summary m3')));
 }finally{release();await f.close();}
});
test('an ambiguous in-flight outcome is not resent after privacy changes',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let held=false;
 const f=await setup({uniqueSummaries:true,postHook:async m=>{if(m.text.includes('Summary m1')&&!held){held=true;entered();await gate;throw Error('unknown Slack outcome');}}});try {
  let prefs=await enableTestInbox(f);f.setArrivals(['m1']);await f.call('/api/plugins/gmail/poll',f.token,{});await started;prefs={...prefs,sensitiveTerms:['private']};assert.equal((await changeTestInbox(f,prefs))[0],200);release();
  const item=await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.find(i=>i.state==='uncertain'));const decision={kind:'item',id:item.attemptId,decision:'resend',expectedText:item.preview,confirm:true};assert.notEqual((await f.call('/api/plugins/gmail/resolve-delivery',f.token,decision))[0],200);
  await f.restart();await new Promise(r=>setTimeout(r,350));assert.ok(!f.posts.some(p=>p.text.includes('Summary m1')));
 }finally{release();await f.close();}
});
test('a rejected clarification is rebound after an in-flight privacy edit',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let held=false;
 const f=await setup({uniqueSummaries:true,privateAssessment:true,postHook:async m=>{if(m.text.includes('may need private handling')&&!held){held=true;entered();await gate;throw new SlackRateLimited(1200);}}});try {
  let prefs=await enableTestInbox(f);f.setArrivals(['m1']);await f.call('/api/plugins/gmail/poll',f.token,{});await started;prefs={...prefs,sensitiveTerms:['private']};assert.equal((await changeTestInbox(f,prefs))[0],200);release();await new Promise(r=>setTimeout(r,400));assert.ok(!f.posts.some(p=>p.text.includes('may need private handling')));
  const question=await wait(()=>f.posts.find(p=>p.text.includes('may need private handling')));await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.some(i=>i.state==='awaiting'));await f.say({eventId:'answer-retried-question',teamId:'T123',userId:'U123',channelId:'D123',threadTs:question.messageTs,text:'yes'});await wait(()=>f.posts.some(p=>p.text.includes('Summary m1')));
 }finally{release();await f.close();}
});
test('a rejected approved disclosure needs new clarification after a privacy edit',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let held=false;
 const f=await setup({uniqueSummaries:true,privateAssessment:true,postHook:async m=>{if(m.text.includes('Summary m1')&&!held){held=true;entered();await gate;throw new SlackRateLimited(1200);}}});try {
  let prefs=await enableTestInbox(f);f.setArrivals(['m1']);await f.call('/api/plugins/gmail/poll',f.token,{});const question=await wait(()=>f.posts.find(p=>p.text.includes('may need private handling')));await wait(async()=>((await f.call('/api/plugins',f.token))[1].find(p=>p.id==='gmail')).inboxStatus.items.some(i=>i.state==='awaiting'));await f.say({eventId:'first-approval',teamId:'T123',userId:'U123',channelId:'D123',threadTs:question.messageTs,text:'yes'});await started;
  prefs={...prefs,sensitiveTerms:['new topic']};assert.equal((await changeTestInbox(f,prefs))[0],200);release();await new Promise(r=>setTimeout(r,400));assert.equal(f.posts.filter(p=>p.text.includes('may need private handling')).length,1);await wait(()=>f.posts.filter(p=>p.text.includes('may need private handling')).length===2);assert.ok(!f.posts.some(p=>p.text.includes('Summary m1')));
 }finally{release();await f.close();}
});
