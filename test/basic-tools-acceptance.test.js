import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Instance} from '../dist/instance.js';
import {startControlledInstance as startInstance} from './fixtures/controlled-instance.mjs';

const assistant = content => ({role:'assistant', content});
const tools = calls => ({role:'assistant', content:null, tool_calls:calls.map(([name,input]) => ({id:name, type:'function', function:{name, arguments:JSON.stringify(input)}}))});
const scope = {kind:'agent'};
async function until(read) {
  for (let n=0; n<1000; n++) {
    const value=await read();
    if (value) return value;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw Error('Acceptance operation timed out');
}
async function client(app) {
  const port=await app.listen();
  let token;
  async function call(path, body, credential=token) {
    const response=await fetch(`http://127.0.0.1:${port}${path}`, {
      method:body===undefined?'GET':'POST',
      headers:{...(credential?{Authorization:`Bearer ${credential}`} : {}), ...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const value=await response.json();
    assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`);
    return value;
  }
  token=(await call('/api/pair',{code:app.code})).token;
  const wait=id=>until(async()=>{const work=await call('/api/commands/'+id); return work.state!=='pending' && work;});
  return {call,wait};
}

test('one accepted workflow combines skills, files, memory and retained native input in all modes without restart replay', async()=>{
  const directory=mkdtempSync(join(tmpdir(),'staf-combined-acceptance-'));
  const path=join(directory,'instance.sqlite');
  const shell={command:`exec ${JSON.stringify(process.execPath)} -e 'process.stdin.on("data",b=>process.stdout.write("echo:"+b))'`,retain:true};
  const seen=[];
  let skill, app;
  const records=[];
  try {
    app=startInstance(path,0,{env:{},providerFactory:async profile=>({name:'controlled', capabilities:{toolCalls:true}, async complete(messages,offers,options) {
      seen.push(structuredClone({messages,offers,profile}));
      if (options.currentUserInput==='Check later replay') return assistant('Later turn completed.');
      const after=messages.slice(messages.findLastIndex(message=>message.role==='user')+1);
      const results=after.filter(message=>message.role==='tool');
      const value=name=>JSON.parse(results.findLast(message=>message.tool_call_id===name).content);
      if (profile.toolMode!=='direct') {
        if (results.length) return assistant('Combined workflow completed.');
        return tools([['code_mode',{source:`
          await capabilities.select_skill({id:${JSON.stringify(skill.id)},revision:1});
          const file=(await capabilities.file_write({path:'acceptance.txt',content:'one'})).value;
          const memory=(await capabilities.memory_remember({scope:{kind:'agent'},text:'first memory',classification:'ordinary'})).value;
          const process=(await capabilities.terminal_run(${JSON.stringify(shell)})).value;
          await capabilities.file_edit({path:'acceptance.txt',expectedHash:file.sha256,oldText:'one',newText:'two'});
          const updated=(await capabilities.memory_update({scope:{kind:'agent'},id:memory.id,version:memory.version,text:'updated memory',classification:'ordinary'})).value;
          await capabilities.terminal_write({processId:process.id,data:'line\\n'});
          const found=(await capabilities.file_search({path:'acceptance.txt',query:'two'})).value;
          await capabilities.memory_forget({scope:{kind:'agent'},id:updated.id,version:updated.version});
          await capabilities.terminal_read({processId:process.id});
          return found;
        `}]]);
      }
      if (results.length===0) return tools([
        ['select_skill',{id:skill.id,revision:1}],
        ['file_write',{path:'acceptance.txt',content:'one'}],
        ['memory_remember',{scope,text:'first memory',classification:'ordinary'}],
        ['terminal_run',shell]
      ]);
      if (results.length===4) return tools([
        ['file_edit',{path:'acceptance.txt',expectedHash:value('file_write').sha256,oldText:'one',newText:'two'}],
        ['memory_update',{scope,id:value('memory_remember').id,version:value('memory_remember').version,text:'updated memory',classification:'ordinary'}],
        ['terminal_write',{processId:value('terminal_run').id,data:'line\n'}]
      ]);
      if (results.length===7) return tools([
        ['file_search',{path:'acceptance.txt',query:'two'}],
        ['memory_forget',{scope,id:value('memory_update').id,version:value('memory_update').version}],
        ['terminal_read',{processId:value('terminal_run').id}]
      ]);
      return assistant('Combined workflow completed.');
    }})});
    let {call,wait}=await client(app);
    const second=(await call('/api/pair',{code:app.issueCode()})).token;
    skill=await call('/api/skills',{name:'Combined acceptance',description:'fixture',provenance:'owner',body:'COMBINED_SKILL_BODY'});
    for (const mode of ['direct','hybrid','code']) {
      const bot=await call('/api/bots',{provider:'live',model:'fixture-offline',name:'Combined '+mode,toolMode:mode});
      await call(`/api/skills/${skill.id}/availability`,{botId:bot.id,available:true});
      const request={id:'combined-'+mode,botId:bot.id,content:'Run combined workflow'};
      await call('/api/commands',request);
      const work=await wait(request.id);
      assert.equal(work.state,'completed',work.error);
      assert.equal(work.workActions.length,10,JSON.stringify(work));
      assert.ok(work.workActions.every(action=>action.state==='succeeded'),JSON.stringify(work.workActions));
      assert.equal(new Set(work.workActions.map(action=>action.id)).size,10);
      assert.equal(work.skillActivity.length,1);
      if (mode!=='direct') assert.deepEqual(new Set(work.codeExecutions[0].actions),new Set(work.workActions.map(action=>action.id)));
      const process=(await call('/api/processes',undefined,second)).find(process=>process.work.id===request.id);
      assert.equal(process.state,'running');
      assert.equal(process.retained,true);
      assert.equal(readFileSync(join(process.cwd,'acceptance.txt'),'utf8'),'two');
      assert.deepEqual(await call(`/api/memories/bot/${bot.id}`),[]);
      await until(async()=>JSON.stringify(await call(`/api/processes/${process.id}/output`,undefined,second)).includes('echo:line'));
      await call(`/api/processes/${process.id}/stop`,{},second);
      await until(async()=>(await call(`/api/processes/${process.id}`)).outputComplete);
      const offset=seen.length;
      await call('/api/commands',{id:'later-'+mode,botId:bot.id,content:'Check later replay'});
      assert.equal((await wait('later-'+mode)).state,'completed');
      assert.doesNotMatch(JSON.stringify(seen[offset].messages),/COMBINED_SKILL_BODY/);
      records.push({request,actions:work.workActions.map(action=>action.id),process});
    }
    await app.close(); app=undefined;
    let providerCalls=0;
    app=startInstance(path,0,{env:{},providerFactory:async()=>{providerCalls++;throw Error('Completed work must not replay');}});
    ({call,wait}=await client(app));
    for (const {request,actions,process} of records) {
      await call('/api/commands',request);
      const work=await wait(request.id);
      assert.equal(work.state,'completed');
      assert.deepEqual(work.workActions.map(action=>action.id),actions);
      assert.equal(readFileSync(join(process.cwd,'acceptance.txt'),'utf8'),'two');
      assert.deepEqual(await call(`/api/memories/bot/${request.botId}`),[]);
      assert.equal((await call(`/api/processes/${process.id}`)).state,'exited');
    }
    assert.equal(providerCalls,0);
  } finally {
    if (app) await app.close();
    rmSync(directory,{recursive:true,force:true});
  }
});

test('a real SQLite effect with a lost receipt fences later paired changing calls across styles',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'staf-paired-uncertainty-'));
  const path=join(directory,'instance.sqlite');
  const setup=new Instance(path), rows=[];
  try {
    for (const mode of ['direct','hybrid','code']) {
      const bot=setup.createBot({provider:'live',model:'fixture-offline',name:'Uncertain '+mode,instructions:'',toolMode:mode});
      const memory=setup.memories.create({scope:{kind:'bot',botId:bot.id},text:'before'});
      rows.push({bot,memory});
    }
    setup.db.exec("CREATE TRIGGER lost_memory_receipt AFTER UPDATE ON memories WHEN NEW.text='uncertain change' BEGIN SELECT RAISE(FAIL, 'fixture lost receipt'); END");
  } finally {setup.close();}
  let app;
  try {
    app=startInstance(path,0,{env:{},providerFactory:async profile=>({name:'controlled',capabilities:{toolCalls:true},async complete(messages) {
      const after=messages.slice(messages.findLastIndex(message=>message.role==='user')+1);
      const count=after.filter(message=>message.role==='tool').length;
      if (count===2) return assistant('Uncertain work reported.');
      const {memory}=rows.find(row=>row.bot.toolMode===profile.toolMode);
      const input={scope,id:memory.id,version:count+1,text:count?'must not run':'uncertain change',classification:'ordinary'};
      const route=profile.toolMode==='direct' || (profile.toolMode==='hybrid' && count===1);
      return route?tools([['memory_update',input]]):tools([['code_mode',{source:`return await capabilities.memory_update(${JSON.stringify(input)});`}]]);
    }})});
    const {call,wait}=await client(app);
    for (const {bot,memory} of rows) {
      await call('/api/commands',{id:'uncertain-'+bot.toolMode,botId:bot.id,content:'Run uncertainty fixture'});
      const work=await wait('uncertain-'+bot.toolMode);
      assert.equal(work.state,'completed',work.error);
      assert.equal(work.workActions.length,1,JSON.stringify(work.workActions));
      assert.equal(work.workActions[0].state,'uncertain');
      const saved=(await call(`/api/memories/bot/${bot.id}`)).find(item=>item.id===memory.id);
      assert.equal(saved.text,'uncertain change');
      assert.equal(saved.version,2);
    }
  } finally {
    if (app) await app.close();
    rmSync(directory,{recursive:true,force:true});
  }
});
