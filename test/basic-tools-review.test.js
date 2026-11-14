import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startControlledInstance as startInstance} from './fixtures/controlled-instance.mjs';
import {Instance} from '../dist/instance.js';

const tool=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:'review',type:'function',function:{name,arguments:JSON.stringify(args)}}]});
async function paired(path,respond,env={}) {
  const app=startInstance(path,0,{env,providerFactory:async profile=>({name:'controlled',capabilities:{toolCalls:true},complete:(messages,offers,options)=>respond(profile,messages,offers,options)})});
  const port=await app.listen();let token;
  const call=async(path,body)=>{
    const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
  };
  const credential=await call('/api/pair',{code:app.code});token=credential.token;
  const wait=async id=>{for(let n=0;n<1000;n++){const work=await call('/api/commands/'+id);if(work.state!=='pending')return work;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Review fixture timed out');};
  return {app,call,wait,url:`http://127.0.0.1:${port}`,credential};
}

test('random file pages reject credentials crossing either byte boundary in every mode',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'staf-file-boundary-'));
  const secret='synthetic-雪-credential-"tail',seen=[];
  const f=await paired(join(directory,'db'),(profile,messages,_offers,options)=>{
    seen.push(structuredClone(messages));
    if(messages.at(-1).role==='tool')return {role:'assistant',content:'Page inspected.'};
    const input=JSON.parse(options.currentUserInput);
    return profile.toolMode==='direct'?tool('file_read',input):tool('code_mode',{source:`return (await capabilities.file_read(${JSON.stringify(input)})).value;`});
  },{OPENROUTER_API_KEY:secret});
  try {
    const safe=join(directory,'safe');writeFileSync(safe,'ordinary file');
    let serial=0;
    for(const mode of ['direct','hybrid','code']){
      const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:mode,toolMode:mode});
      for(const [variantIndex,variant] of [secret,JSON.stringify(secret).slice(1,-1)].entries()){
        const path=join(directory,'sensitive-'+variantIndex),bytes=Buffer.from(variant);writeFileSync(path,Buffer.concat([Buffer.from('prefix:'),bytes,Buffer.from(':suffix')]));
        for(const relative of [0,Math.floor(bytes.length/2),bytes.length-1]){
          const id='page-'+ ++serial;
          await f.call('/api/commands',{id,botId:bot.id,content:JSON.stringify({path,offset:7+relative,limit:1})});
          const work=await f.wait(id);
          assert.equal(work.state,'completed',work.error);assert.equal(work.workActions.length,1);
          assert.equal(work.workActions[0].state,'cancelled');
          if(mode!=='direct')assert.equal(work.codeExecutions[0].outcome,'error');
        }
      }
      const id='safe-'+mode;await f.call('/api/commands',{id,botId:bot.id,content:JSON.stringify({path:safe,offset:2,limit:4})});
      const work=await f.wait(id);assert.equal(work.workActions[0].state,'cancelled');
      if(mode!=='direct')assert.equal(work.codeExecutions[0].outcome,'error');
    }
    assert.equal(JSON.stringify(seen).includes(secret),false);
  } finally {await f.app.close();rmSync(directory,{recursive:true,force:true});}
});

test('pattern-recognized tokens cannot escape random file pages when not configured as keys',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'staf-pattern-page-')),path=join(directory,'token.txt'),safe=join(directory,'ordinary.txt');
  const token='sk-or-v1-'+ 'q7z_'.repeat(30000);writeFileSync(path,'prefix:'+token+':end');writeFileSync(safe,'ordinary_name '.repeat(10000));
  const f=await paired(join(directory,'db'),(profile,messages,_offers,options)=>{
    if(messages.at(-1).role==='tool')return {role:'assistant',content:'Page checked.'};
    const input=JSON.parse(options.currentUserInput);
    return profile.toolMode==='direct'?tool('file_read',input):tool('code_mode',{source:`return (await capabilities.file_read(${JSON.stringify(input)})).value;`});
  });
  try {
    let serial=0;
    for(const mode of ['direct','hybrid','code']){
      const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'Pattern '+mode,toolMode:mode});
      for(const relative of [0,4096,100000,token.length-1]){
        const id='pattern-'+ ++serial;await f.call('/api/commands',{id,botId:bot.id,content:JSON.stringify({path,offset:7+relative,limit:16})});
        const work=await f.wait(id);assert.equal(work.state,'completed',work.error);assert.equal(work.workActions.length,1);
        assert.equal(work.workActions[0].state,'failed',JSON.stringify(work));assert.match(work.workActions[0].result,/cannot be retained safely|credential boundary/);
      }
      const id='ordinary-'+mode;await f.call('/api/commands',{id,botId:bot.id,content:JSON.stringify({path:safe,offset:100000,limit:16})});
      const work=await f.wait(id);assert.equal(work.workActions[0].state,'succeeded');
      if(mode!=='direct')assert.equal(Buffer.from(work.codeExecutions[0].result.value.data,'base64').toString(),readFileSync(safe).subarray(100000,100016).toString());
    }
  } finally {await f.app.close();rmSync(directory,{recursive:true,force:true});}
});

test('unselected guest reads leave action metadata but no durable payload receipts',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'staf-read-lifetime-')),path=join(directory,'db'),file=join(directory,'read.txt');
  const fileText='Unselected amber file payload'.repeat(10000),memoryText='Unselected cobalt memory payload';writeFileSync(file,fileText);
  let memory,closed=false;
  const f=await paired(path,(_profile,messages)=>messages.at(-1).role==='tool'?{role:'assistant',content:'Selected output only.'}:tool('code_mode',{source:`for(let offset=0;offset<8*32768;offset+=32768)await capabilities.file_read({path:${JSON.stringify(file)},offset,limit:32768}); await capabilities.memory_read({scope:{kind:'agent'},id:${JSON.stringify(memory.id)}}); return 'selected';`}));
  try {
    const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'Read lifetime',toolMode:'code'});
    memory=await f.call(`/api/memories/bot/${bot.id}`,{text:memoryText});
    await f.call('/api/commands',{id:'read-lifetime',botId:bot.id,content:'Inspect fixture reads.'});
    const work=await f.wait('read-lifetime');assert.equal(work.state,'completed',work.error);assert.equal(work.workActions.length,9);
    assert.equal(work.codeExecutions[0].result.value,'selected');
    assert.doesNotMatch(JSON.stringify(work),/Unselected (amber|cobalt)/);
    await f.app.close();closed=true;
    const db=new DatabaseSync(path,{readOnly:true});
    try {
      assert.equal(db.prepare("SELECT count(*) AS n FROM work_action_invocations WHERE kind='command' AND work_id='read-lifetime' AND private_result IS NOT NULL").get().n,0);
      const results=db.prepare("SELECT result FROM action_journal WHERE command_id='read-lifetime'").all();
      assert.doesNotMatch(JSON.stringify(results),/Unselected (amber|cobalt)/);
    } finally {db.close();}
    assert.equal(readFileSync(file,'utf8'),fileText);
  } finally {if(!closed)await f.app.close();rmSync(directory,{recursive:true,force:true});}
});

test('read receipts resume while work is open and expire without rerunning after release',async()=>{
  const instance=new Instance(':memory:');let calls=0;
  try {
    const bot=instance.createBot({provider:'live',model:'fixture-offline',name:'Read receipt',instructions:'',toolMode:'direct'});instance.claim({id:'receipt',botId:bot.id,content:'read'});
    const registry=instance.workActions();registry.register({name:'read_fixture',definition:{type:'function',function:{name:'read_fixture',description:'read',parameters:{type:'object'}}},parseInput:()=>({}),parseResult:value=>value,describe:()=>({summary:'Read fixture',resource:'fixture',effect:'read'}),eligible:()=>true,check:()=>{},authorize:async()=>{},execute:async()=>{calls++;return 'temporary receipt';},visibleResult:()=> 'Read completed'});
    const request=callId=>({source:{kind:'provider',responseId:'fixture',callId},name:'read_fixture',input:{},intent:{kind:'new'}});
    let actions=registry.open({kind:'command',id:'receipt'},new AbortController().signal);
    const first=await actions.invoke(request('first'));assert.equal(first.value,'temporary receipt');
    assert.equal((await actions.invoke({...request('resume'),intent:{kind:'resume',actionId:first.actionId}})).value,'temporary receipt');
    actions.dispose();actions=registry.open({kind:'command',id:'receipt'},new AbortController().signal);
    const expired=await actions.invoke({...request('expired'),intent:{kind:'resume',actionId:first.actionId}});assert.equal(expired.kind,'status');assert.equal(expired.action.state,'succeeded');assert.equal(calls,1);
    instance.db.prepare("UPDATE work_action_invocations SET description=? WHERE action_id=?").run('{"effect":"invalid"}',first.actionId);
    await assert.rejects(()=>actions.invoke(request('corrupt')));assert.equal(calls,1);actions.dispose();
  } finally {instance.close();}
});

test('paired owner and CLI reconcile only a settled observed native action before a fresh change',async()=>{
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  for(const mode of ['hybrid','code']){
    const directory=mkdtempSync(join(tmpdir(),'staf-native-resolution-'));
    let ready,release;const held=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);
    const f=await paired(join(directory,'db'),async(_profile,messages)=>{
      const results=messages.slice(messages.findLastIndex(message=>message.role==='user')+1).filter(message=>message.role==='tool');
      if(!results.length)return tool('code_mode',{source:`await capabilities.terminal_run({command:'printf "ready\\n"; read line',retain:true});throw Error('ordinary failure');`});
      if(results.length===3)return {role:'assistant',content:'Resolved work completed.'};
      if(results.length===2){ready();await gate;}
      const input={path:'after-resolution.txt',content:'after'};
      return mode==='hybrid'?tool('file_write',input):tool('code_mode',{source:`return (await capabilities.file_write(${JSON.stringify(input)})).value;`});
    });
    try {
      const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'Resolve '+mode,toolMode:mode});
      await f.call('/api/commands',{id:'resolve',botId:bot.id,content:'Resolve the controlled native fixture.'});await held;
      const work=await f.call('/api/commands/resolve');assert.equal(work.workActions.length,1);
      const process=(await f.call('/api/processes'))[0],action=work.workActions[0];
      const route=`/api/work-actions/command/resolve/${action.id}/reconcile`;
      assert.equal((await fetch(f.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
      await assert.rejects(()=>f.call(route,{evidence:{processId:process.id,observedCursor:process.nextCursor}}));
      await f.call(`/api/processes/${process.id}/stop`,{});
      let settled;for(let n=0;n<500;n++){settled=await f.call('/api/processes/'+process.id);if(settled.outputComplete)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(settled.outputComplete,true);
      await assert.rejects(()=>f.call(route,{evidence:{processId:process.id,observedCursor:settled.nextCursor+1}}));
      await assert.rejects(()=>f.call(`/api/work-actions/command/resolve/${'00000000-0000-0000-0000-000000000000'}/reconcile`,{evidence:{processId:process.id,observedCursor:settled.nextCursor}}));
      const evidence=join(directory,'evidence.json'),credential=join(directory,'client.json');
      writeFileSync(evidence,JSON.stringify({processId:process.id,observedCursor:settled.nextCursor}));writeFileSync(credential,JSON.stringify(f.credential));
      const response=await promisify(execFile)(globalThis.process.execPath,['dist/cli.js','instance','reconcile-action',f.url,credential,'command','resolve',action.id,evidence]);
      assert.deepEqual(JSON.parse(response.stdout).resolutions,[action.id]);
      release();const done=await f.wait('resolve');assert.equal(done.state,'completed',done.error);assert.equal(done.workActions.length,2);
      assert.equal(readFileSync(join(process.cwd,'after-resolution.txt'),'utf8'),'after');
      assert.equal((await f.call('/api/processes')).length,1);
    } finally {release();await f.app.close();rmSync(directory,{recursive:true,force:true});}
  }
});

test('memory evidence resolves a lost receipt but an apparent repeat still requires a challenge',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'staf-memory-resolution-')),path=join(directory,'db');
  const setup=new Instance(path);let bot,memory;
  try {bot=setup.createBot({provider:'live',model:'fixture-offline',name:'Memory evidence',instructions:'',toolMode:'hybrid'});memory=setup.memories.create({scope:{kind:'bot',botId:bot.id},text:'before'});setup.db.exec("CREATE TRIGGER lost_receipt AFTER UPDATE ON memories BEGIN SELECT RAISE(FAIL, 'lost receipt'); END");}finally{setup.close();}
  let ready,release;const held=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve),seen=[];
  const input={scope:{kind:'agent'},id:memory.id,version:1,text:'after',classification:'ordinary'};
  const f=await paired(path,async(_profile,messages)=>{
    const results=messages.slice(messages.findLastIndex(message=>message.role==='user')+1).filter(message=>message.role==='tool');seen.push(structuredClone(results));
    if(!results.length)return tool('code_mode',{source:`return await capabilities.memory_update(${JSON.stringify(input)});`});
    if(results.length===1){ready();await gate;return tool('memory_update',input);}
    return {role:'assistant',content:'Repeat requires a decision.'};
  });
  try {
    await f.call('/api/commands',{id:'memory-resolve',botId:bot.id,content:'Resolve memory receipt.'});await held;
    const work=await f.call('/api/commands/memory-resolve'),action=work.workActions[0];assert.equal(action.state,'uncertain');
    const route=`/api/work-actions/command/memory-resolve/${action.id}/reconcile`;
    await assert.rejects(()=>f.call(route,{evidence:{version:1}}));
    assert.deepEqual((await f.call(route,{evidence:{version:2}})).resolutions,[action.id]);
    release();const done=await f.wait('memory-resolve');assert.equal(done.state,'completed');assert.equal(done.workActions.length,1);
    assert.match(seen.at(-1).at(-1).content,/repeat-required/);assert.equal((await f.call(`/api/memories/bot/${bot.id}`))[0].version,2);
  } finally {release();await f.app.close();rmSync(directory,{recursive:true,force:true});}
});

test('an active task retry reconciles a predecessor process through its own accepted context',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'staf-task-resolution-'));
  let phase='first',ready,release;const held=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);
  const f=await paired(join(directory,'db'),async(_profile,messages)=>{
    const results=messages.slice(messages.findLastIndex(message=>message.role==='user')+1).filter(message=>message.role==='tool');
    if(phase==='first'){
      if(results.length)throw Error('Controlled provider failure');
      return tool('code_mode',{source:`await capabilities.terminal_run({command:'printf "task effect"'});throw Error('ordinary guest failure');`});
    }
    if(results.length===2)return {role:'assistant',content:'Task retry completed.'};
    if(results.length===1){ready();await gate;}
    return tool('code_mode',{source:`return (await capabilities.file_write({path:'task-resolution.txt',content:'resolved'})).value;`});
  });
  const taskDone=async id=>{for(let n=0;n<1000;n++){const task=await f.call('/api/tasks/'+id);if(!['queued','running'].includes(task.state))return task;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Task timed out');};
  try {
    const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'Task resolution',toolMode:'code'}),request={id:'first',botId:bot.id,objective:'Resolve predecessor effect',limitMs:300000};
    await f.call('/api/tasks',request);const first=await taskDone('first');assert.equal(first.state,'failed');assert.equal(first.workActions.length,1);
    phase='retry';await f.call('/api/tasks',{...request,id:'retry',predecessor:'first'});await held;
    let process;for(let n=0;n<500;n++){process=(await f.call('/api/processes'))[0];if(process.outputComplete)break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(process.outputComplete,true);
    const resolution=await f.call(`/api/work-actions/task/retry/${first.workActions[0].id}/reconcile`,{evidence:{processId:process.id,observedCursor:process.nextCursor}});
    assert.deepEqual(resolution.resolutions,[first.workActions[0].id]);release();
    const done=await taskDone('retry');assert.equal(done.state,'completed',JSON.stringify(done));assert.equal(done.workActions.length,1);
    assert.equal(readFileSync(join(process.cwd,'task-resolution.txt'),'utf8'),'resolved');assert.equal((await f.call('/api/processes')).length,1);
  } finally {release();await f.app.close();rmSync(directory,{recursive:true,force:true});}
});

test('file-write resolution verifies actual bytes and does not silently replay a lost result',async()=>{
  const {fileCapabilities}=await import('../dist/file-actions.js'),{createHash}=await import('node:crypto');
  const instance=new Instance(':memory:');let writes=0;
  try {
    const bot=instance.createBot({provider:'live',model:'fixture-offline',name:'File evidence',instructions:'',toolMode:'hybrid'});instance.claim({id:'file-resolve',botId:bot.id,content:'write'});
    const registry=instance.workActions(),{write}=fileCapabilities(value=>value,()=>true,()=>16);
    registry.register({...write,execute:async(...args)=>{writes++;await write.execute(...args);throw Error('Lost result after the actual file write');}});
    const actions=registry.open({kind:'command',id:'file-resolve'},new AbortController().signal),input={path:'resolved.txt',content:'actual bytes'};
    const request=callId=>({source:{kind:'provider',responseId:'fixture',callId},name:'file_write',input,intent:{kind:'new'}});
    const first=await actions.invoke(request('first'));assert.equal(first.action.state,'uncertain');
    await assert.rejects(()=>actions.reconcile(first.action.id,{sha256:'0'.repeat(64)}));
    const sha256=createHash('sha256').update(input.content).digest('hex');await actions.reconcile(first.action.id,{sha256});
    const next=await actions.invoke(request('repeat'));assert.equal(next.kind,'repeat-required');assert.equal(writes,1);
    assert.equal(readFileSync(join(actions.context.workingDirectory,input.path),'utf8'),input.content);actions.dispose();
  } finally {instance.close();}
});
