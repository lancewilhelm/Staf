import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';
import {Instance} from '../dist/instance.js';
import {workspaceCapabilities} from '../dist/workspace-capabilities.js';

test('fresh sessions reference original history, documents, and artifact revisions without implicit replay',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'staf-workspace-')),path=join(dir,'db'),requests=[];
  const options={env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'chat-completions'},async complete(messages){requests.push(structuredClone(messages));return {role:'assistant',content:'Fixture answer '+requests.length};}})};
  let app=startInstance(path,0,options),port=await app.listen();
  const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [response.status,await response.json()];};
  let token,otherToken;
  const done=async id=>{for(let n=0;n<100;n++){const [,command]=await call('/api/commands/'+id,token);if(command.state!=='pending'){assert.equal(command.state,'completed',command.error);return command;}await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Command did not settle');};
  try {
    token=(await call('/api/pair',null,{code:app.code}))[1].token;
    otherToken=(await call('/api/pair',null,{code:app.issueCode()}))[1].token;
    const bot=(await call('/api/bots',token,{name:'Research'}))[1],foreign=(await call('/api/bots',token,{name:'Other'}))[1],root='/api/bots/'+bot.id;
    assert.equal((await call('/api/commands',token,{id:'original',botId:bot.id,sessionId:bot.chatId,content:'history-only-fact'}))[1].kind,'accepted');await done('original');
    const older=(await call(root+'/messages',token))[1];
    const fresh=(await call(root+'/sessions',token,{operationId:'fresh-one',expectedSessionId:bot.chatId,name:'Fresh research'}))[1];
    assert.equal((await call('/api/commands',token,{id:'fresh-no-sources',botId:bot.id,sessionId:fresh.id,content:'Start here'}))[1].kind,'accepted');await done('fresh-no-sources');
    assert.doesNotMatch(JSON.stringify(requests.at(-1)),/history-only-fact/);
    assert.equal(requests.at(-1).filter(message=>message.role==='user').length,1);
    const doc=(await call(root+'/documents',token,{operationId:'source-file',name:'facts.txt',base64:Buffer.from('document-only-fact\nA retained original.').toString('base64')}))[1];
    const response=(await call(root+'/messages',token))[1].find(message=>message.role==='assistant');
    const artifact=(await call(root+'/artifacts',token,{operationId:'source-artifact',name:'Draft findings',format:'markdown',content:'artifact-only-fact',source:{sessionId:fresh.id,messageId:response.id}}))[1];
    const references=[{kind:'session-message',sessionId:bot.chatId,messageId:older[0].id},{kind:'document-excerpt',documentId:doc.id,excerptId:'1'},{kind:'artifact-revision',artifactId:artifact.id,revision:1}];
    for(const reference of references){const [status,preview]=await call(root+'/references/preview',token,{reference});assert.equal(status,200);assert.deepEqual(preview.reference,reference);assert.equal((await call('/api/bots/'+foreign.id+'/references/preview',token,{reference}))[0],400);}
    const selected={id:'with-sources',botId:bot.id,sessionId:fresh.id,content:'Compare the selected sources',references};
    assert.equal((await call('/api/commands',token,selected))[1].kind,'accepted');const command=await done(selected.id);
    assert.equal(command.references.length,3);
    for(const fact of ['history-only-fact','document-only-fact','artifact-only-fact'])assert.match(JSON.stringify(requests.at(-1)),new RegExp(fact));
    assert.match(JSON.stringify(requests.at(-1)),/untrusted data/);
    const visible=(await call(root+'/messages',token))[1];assert.equal(visible.find(message=>message.id==='command-user-with-sources').content,selected.content);
    const work=(await call(root+'/chat-work',token))[1];assert.equal(work.requests.find(item=>item.id===selected.id).references.length,3);
    assert.ok(work.requests.find(item=>item.id===selected.id).references.every(source=>!('content' in source)));
    assert.deepEqual((await call(root+'/sessions/'+bot.chatId,token))[1].messages,older);
    await call(root+'/documents/'+doc.id+'/retire',token,{});
    assert.equal((await call(root+'/references/preview',token,{reference:references[1]}))[0],400);
    assert.equal((await call(root+'/references/preview',token,{reference:references[1],inspect:true}))[0],200);
    assert.equal((await call('/api/commands',token,selected))[1].kind,'existing');
    assert.equal((await call('/api/commands',token,{...selected,references:references.slice(0,1)}))[0],400);
    const next=(await call(root+'/sessions',token,{operationId:'fresh-two',expectedSessionId:fresh.id}))[1];
    await call('/api/commands',token,{id:'another-fresh',botId:bot.id,sessionId:next.id,content:'A new conversation'});await done('another-fresh');
    assert.doesNotMatch(JSON.stringify(requests.at(-1)),/history-only-fact|document-only-fact|artifact-only-fact|Compare the selected sources/);
    const large=[];for(let i=0;i<5;i++){const item=(await call(root+'/artifacts',token,{operationId:'large-'+i,name:'Large '+i,format:'text',content:'x'.repeat(6000)}))[1];large.push({kind:'artifact-revision',artifactId:item.id,revision:1});}
    assert.equal((await call('/api/commands',token,{id:'too-much-context',botId:bot.id,sessionId:next.id,content:'Too many source characters',references:large}))[0],400);
    assert.equal((await call('/api/commands/too-much-context',token))[0],404);
    assert.equal((await call(root+'/messages',token))[1].length,2);
    await app.close();app=startInstance(path,0,options);port=await app.listen();
    assert.deepEqual((await call('/api/commands/with-sources',otherToken))[1].references,command.references);
    assert.equal((await call('/api/commands',token,selected))[1].kind,'existing');
    const clients=(await call('/api/clients',token))[1];await call('/api/clients/'+clients.find(client=>!client.current).id+'/revoke',token,{});
    assert.equal((await call('/api/commands/with-sources',otherToken))[0],401);
  } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('workspace adapters retain captured audience and stop before another source action',()=>{
  const instance=new Instance(':memory:');
  try {
    const bot=instance.createBot({name:'A',instructions:''}),other=instance.createBot({name:'B',instructions:''});
    instance.claim({id:'active',botId:bot.id,content:'hello'});
    const controller=new AbortController(),scope={botId:bot.id,sessionId:bot.chatId,commandId:'active',signal:controller.signal};
    const capabilities=workspaceCapabilities(instance,scope);scope.botId=other.id;scope.sessionId=other.chatId;
    const item=capabilities.artifacts.create({operationId:'held-artifact',name:'Findings',format:'text',content:'local result'});
    assert.equal(capabilities.artifacts.read(item.id,1).content,'local result');assert.equal(capabilities.sessions.current().id,bot.chatId);
    instance.requestResponseStop('active');
    assert.throws(()=>capabilities.sessions.search('hello'),/authorized/);assert.throws(()=>capabilities.documents.list(),/active/);assert.throws(()=>capabilities.artifacts.read(item.id,1),/scope/);
  } finally {instance.close();}
});

test('a history search selects the matching part of a long original message',()=>{
  const instance=new Instance(':memory:');
  try {
    const bot=instance.createBot({name:'History',instructions:''}),original='😀 background '.repeat(1000)+'needle-at-the-end';
    instance.claim({id:'long-original',botId:bot.id,content:original});instance.complete('long-original','Retained');
    instance.createSession({botId:bot.id,expectedSessionId:bot.chatId,operationId:'long-fresh'});
    const [match]=instance.searchSessions(bot.id,'needle-at-the-end');
    assert.ok(match.start>6000);assert.match(match.content,/needle-at-the-end/);
    const reference={kind:'session-message',sessionId:match.sessionId,messageId:match.messageId,start:match.start};
    assert.match(instance.resolveWorkspaceReference(bot.id,reference).content,/needle-at-the-end/);
    assert.equal(instance.readSession(bot.id,bot.chatId).messages[0].content,original);
  } finally {instance.close();}
});

test('older background work settles before a fresh session can start',()=>{
  const instance=new Instance(':memory:');
  try {
    const bot=instance.createBot({name:'Background',instructions:''});
    instance.acceptTask({id:'older-task',botId:bot.id,objective:'An older assignment',limitMs:10000});
    const input={botId:bot.id,expectedSessionId:bot.chatId,operationId:'after-task'};
    assert.throws(()=>instance.createSession(input),/busy/i);
    instance.taskStart('older-task');assert.throws(()=>instance.createSession(input),/busy/i);
    instance.taskStop('older-task','Owner stopped the assignment');assert.throws(()=>instance.createSession(input),/busy/i);
    instance.taskFinish('older-task','stopped','An older task outcome');
    const session=instance.createSession(input);instance.claim({id:'after-task-command',botId:bot.id,sessionId:session.id,content:'Fresh request'});
    assert.deepEqual(instance.execution('after-task-command').notices,[]);
    assert.equal(instance.execution('after-task-command').session.messages.length,0);
    assert.ok(instance.readSession(bot.id,bot.chatId).messages.some(message=>message.content.includes('older task outcome')));
  } finally {instance.close();}
});
