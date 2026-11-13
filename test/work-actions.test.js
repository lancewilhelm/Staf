import test from 'node:test';
import assert from 'node:assert/strict';
import { Instance } from '../dist/instance.js';
import { isAbsolute } from 'node:path';

test('accepted work keeps its captured context through settings changes and submission retry', () => {
  const instance = new Instance(':memory:');
  try {
    let bot = instance.createBot({provider:'live',model:'fixture-offline',name:'Binding', instructions:'original', toolMode:'hybrid'});
    instance.claim({id:'command', botId:bot.id, content:'hello'});
    instance.acceptTask({id:'attempt', botId:bot.id, objective:'work', limitMs:10000});
    const signal = new AbortController().signal;
    const command = instance.workContext({kind:'command',id:'command'}, signal);
    const task = instance.workContext({kind:'task',id:'attempt'}, signal);
    assert.ok(isAbsolute(command.workingDirectory));
    assert.equal(task.workingDirectory, command.workingDirectory);
    assert.equal(command.mode, 'hybrid');
    bot = instance.editBot(bot.id, {...bot,name:'Changed',instructions:'changed',toolMode:'code'});
    instance.claim({id:'command', botId:bot.id, content:'hello'});
    assert.deepEqual(instance.workContext({kind:'command',id:'command'}, signal), command);
    assert.deepEqual(instance.workContext({kind:'task',id:'attempt'}, signal), task);
  } finally { instance.close(); }
});

import {clockCapability} from '../dist/clock-action.js';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';

const source=(callId)=>({kind:'provider',responseId:'response',callId});
const guest=(sequence)=>({kind:'guest',executionId:'script',sequence});
const invoke=(actions,src,name,input,intent={kind:'new'})=>actions.invoke({source:src,name,input,intent});
function localChange({authorize=async()=>{},execute}={}) {
  return {name:'local_change',definition:{type:'function',function:{name:'local_change',description:'Change a local fixture.',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}},
    parseInput:value=>{if (!value || typeof value.value!=='string')throw Error('invalid input');return {value:value.value};},parseResult:value=>{if(typeof value!=='string')throw Error('invalid result');return value;},
    describe:()=>({summary:'Change fixture',resource:'fixture',effect:'change',opaque:true}),eligible:()=>true,check:()=>{},authorize,
    execute:execute ?? (async (input,work)=>{const path=join(work.workingDirectory,'fixture');let before='';try{before=readFileSync(path,'utf8');}catch{}writeFileSync(path,before+input.value);return before+input.value;}),visibleResult:()=> 'Fixture updated'};
}
function fixture(redact) {
  const instance=new Instance(':memory:',redact);const bot=instance.createBot({provider:'live',model:'fixture-offline',name:'Test',instructions:'',toolMode:'hybrid'});instance.claim({id:'c',botId:bot.id,content:'hello'});const controller=new AbortController();return {instance,bot,controller,actions:instance.workActions().open({kind:'command',id:'c'},controller.signal)};
}

test('input normalization cannot introduce a credential before the shared journal boundary',async()=>{
  const {redactor}=await import('../dist/config.js'),secret='syntheticnormalizedcredential';const {instance,actions}=fixture(redactor({OPENROUTER_API_KEY:secret}));let effects=0;
  try{instance.workActions().register({...localChange({execute:async()=>{effects++;return 'changed';}}),parseInput:value=>({value:value.value.replaceAll(' ','')})});for(const src of [source('normalized'),guest(1)])assert.equal((await invoke(actions,src,'local_change',{value:[...secret].join(' ')})).kind,'blocked');assert.equal(effects,0);assert.deepEqual(instance.workActions().inspectActions({kind:'command',id:'c'}),[]);}finally{actions.dispose();instance.close();}
});

test('authority claim starts inside the journal transaction and releases after the effect',async()=>{
  const {instance,actions}=fixture();try {
    let authorized,executed,releases=0,starts=0;
    instance.workActions().register(localChange({
      authorize:async (_input,_work,identity)=>{authorized=identity;return {start:()=>{starts++;assert.equal(instance.db.isTransaction,true);assert.equal(instance.db.prepare('SELECT state FROM action_journal WHERE id=?').get(identity.id).state,'prepared');},release:()=>{releases++;}};},
      execute:async (_input,_work,identity)=>{executed=identity;assert.equal(releases,0);return 'done';},
    }));
    const first=await invoke(actions,source('claim'),'local_change',{value:'x'});
    assert.equal(first.kind,'completed');assert.equal(authorized.id,first.actionId);assert.ok(authorized.fingerprint);assert.ok(Object.isFrozen(authorized));assert.deepEqual(executed,authorized);assert.equal(starts,1);assert.equal(releases,1);
    assert.deepEqual(await invoke(actions,source('claim'),'local_change',{value:'x'}),first);assert.equal(starts,1);assert.equal(releases,1);
  }finally{instance.close();}
});

test('a rejected authority start rolls back and releases without executing',async()=>{
  const {instance,actions}=fixture();try {
    let effects=0,releases=0;instance.db.exec('CREATE TABLE claim_fixture (value TEXT)');
    instance.workActions().register(localChange({authorize:async()=>({start:()=>{instance.db.prepare('INSERT INTO claim_fixture VALUES (?)').run('claimed');throw Error('revoked');},release:()=>{releases++;}}),execute:async()=>{effects++;return 'done';}}));
    const result=await invoke(actions,source('claim-revoked'),'local_change',{value:'x'});
    assert.equal(result.kind,'blocked');assert.equal(effects,0);assert.equal(releases,1);assert.equal(instance.db.prepare('SELECT state FROM action_journal').get().state,'cancelled');assert.equal(instance.db.prepare('SELECT count(*) AS n FROM claim_fixture').get().n,0);
  }finally{instance.close();}
});

test('authority claim releases when work stops after authorization and when execution fails',async()=>{
  for(const scenario of ['stop','failure']) {
    const {instance,controller,actions}=fixture();try {
      let releases=0,effects=0;
      instance.workActions().register(localChange({authorize:async()=>{if(scenario==='stop')controller.abort();return {start:()=>{},release:()=>{releases++;}};},execute:async()=>{effects++;throw Error('unknown');}}));
      const result=await invoke(actions,source(scenario),'local_change',{value:'x'});
      assert.equal(result.kind,scenario==='stop'?'blocked':'status');assert.equal(effects,scenario==='stop'?0:1);assert.equal(releases,1);
      assert.equal(instance.db.prepare('SELECT state FROM action_journal').get().state,scenario==='stop'?'cancelled':'uncertain');
    }finally{instance.close();}
  }
});

test('clock uses existing authorization once and invocation identity is durable',async()=>{
  const {instance,actions}=fixture();try {
    let approvals=0;instance.setApprovalSettings('instance','ask-every-time',true);instance.workActions().register(clockCapability(instance,async work=>{approvals++;const id=instance.requestClockApproval(work.botId,work.work.kind,work.work.id);assert.equal(instance.decideApproval(id,'approved'),'approved');}));
    const first=await invoke(actions,guest(1),'clock',{});assert.equal(first.kind,'completed');
    const retry=await invoke(actions,guest(1),'clock',{});assert.deepEqual(retry,first);assert.equal(approvals,1);
    await assert.rejects(()=>invoke(actions,guest(1),'clock',{invalid:true}));
    assert.equal(instance.db.prepare('SELECT count(*) AS n FROM action_journal').get().n,1);assert.equal(instance.approvalRequests().length,1);
  }finally{instance.close();}
});

test('recovery resumes completed changes and requires a single-use repeat challenge',async()=>{
  const {instance,actions}=fixture();try {
    instance.workActions().register(localChange());
    const first=await invoke(actions,guest(1),'local_change',{value:'x'});assert.equal(first.kind,'completed');
    await assert.rejects(()=>invoke(actions,guest(1),'local_change',{value:'other'}),/conflicts/);
    await assert.rejects(()=>invoke(actions,guest(1),'local_change',{value:'x',extra:true}),/conflicts/);
    actions.beginRecovery();
    const resumed=await invoke(actions,source('resume'),'local_change',{value:'x'},{kind:'resume',actionId:first.actionId});assert.equal(resumed.value,'x');
    const offered=await invoke(actions,source('new'),'local_change',{value:'x'});assert.equal(offered.kind,'repeat-required');
    const repeated=await invoke(actions,source('repeat'),'local_change',{value:'x'},{kind:'repeat',challenge:offered.challenge});assert.equal(repeated.value,'xx');
    await assert.rejects(()=>invoke(actions,source('second'),'local_change',{value:'x'},{kind:'repeat',challenge:offered.challenge}),/challenge/i);
    assert.equal(readFileSync(join(actions.context.workingDirectory,'fixture'),'utf8'),'xx');
    assert.equal(instance.db.prepare('SELECT count(*) AS n FROM action_journal').get().n,2);
  }finally{instance.close();}
});

test('recovery challenges equivalent isolated workspace paths',async()=>{
 const {isolatedFileCapabilities}=await import('../dist/linux-file-actions.js');const {instance,actions}=fixture();let effects=0;
 try {const files=isolatedFileCapabilities({workspace:'/srv/staf-workspace',recheck(){}},value=>value,()=>true,()=>16);instance.workActions().register({...files.write,execute:async()=>{effects++;return {bytes:3,sha256:'a'.repeat(64)};}});
  const first=await invoke(actions,source('host-path'),'file_write',{path:'/srv/staf-workspace/a',content:'one'});assert.equal(first.kind,'completed');actions.beginRecovery();
  const repeat=await invoke(actions,source('visible-path'),'file_write',{path:'/workspace/a',content:'one'});assert.equal(repeat.kind,'repeat-required');assert.equal(effects,1);
  const same=await invoke(actions,source('visible-path'),'file_write',{path:'/workspace/a',content:'one'});assert.equal(same.kind,'repeat-required');assert.equal(same.challenge,repeat.challenge);assert.equal(effects,1);
  const confirmed=await invoke(actions,source('confirmed'),'file_write',{path:'/workspace/a',content:'one'},{kind:'repeat',challenge:repeat.challenge});assert.equal(confirmed.kind,'completed');assert.equal(effects,2);
 }finally{actions.dispose();instance.close();}
});

test('question continuation blocks an equivalent isolated terminal command',async()=>{
 const {nativeCommandCapability,NativeProcesses}=await import('../dist/native-processes.js');const {isolatedWorkingDirectory}=await import('../dist/linux-host-boundary.js');const {instance,bot,actions,controller}=fixture();let starts=0,continuation;
 try {const manager=new NativeProcesses(instance.db);instance.workActions().register(nativeCommandCapability(manager,()=>true,value=>value,async()=>{starts++;return {started:true};},cwd=>'/workspace/'+isolatedWorkingDirectory('/srv/staf-workspace',cwd)));
  const first=await invoke(actions,source('original'),'terminal_run',{command:'printf safe',cwd:'/srv/staf-workspace/project'});assert.equal(first.kind,'completed');instance.db.prepare('INSERT INTO work_action_resolutions VALUES (?)').run(first.actionId);
  instance.questionSets.create('question',bot.id,'c',{questions:[{kind:'text',prompt:'Continue?'}]});const request=instance.questionSets.list()[0];instance.complete('c','waiting for answer');actions.dispose();instance.claim({id:request.continuationId,botId:bot.id,content:'Answer'});continuation=instance.workActions().open({kind:'command',id:request.continuationId},controller.signal);
  const repeated=await invoke(continuation,source('continuation'),'terminal_run',{command:'printf safe',cwd:'/workspace/project'});assert.equal(repeated.kind,'blocked');assert.match(repeated.reason,/originating work cannot be repeated/);assert.equal(starts,1);
 }finally{continuation?.dispose();actions.dispose();instance.close();}
});

test('stop during authorization prevents the effect and closes queued admission',async()=>{
  const {instance,controller,actions}=fixture();try {
    let release;let entered;const waiting=new Promise(resolve=>{entered=resolve;});const gate=new Promise(resolve=>{release=resolve;});let effects=0;
    instance.workActions().register(localChange({authorize:async()=>{entered();await gate;},execute:async()=>{effects++;return 'done';}}));
    const first=invoke(actions,guest(1),'local_change',{value:'x'});await waiting;
    const second=invoke(actions,source('queued'),'local_change',{value:'y'});controller.abort();release();
    assert.equal((await first).kind,'blocked');await assert.rejects(second);assert.equal(effects,0);
    assert.equal(instance.db.prepare('SELECT state FROM action_journal').get().state,'cancelled');
  }finally{instance.close();}
});

test('denial and exhausted shared budget cannot be bypassed by switching route',async()=>{
  {
    const {instance,actions}=fixture();try {
      let effects=0;instance.workActions().register(localChange({authorize:async()=>{throw Error('denied');},execute:async()=>{effects++;return 'done';}}));
      assert.equal((await invoke(actions,guest(1),'local_change',{value:'x'})).kind,'blocked');
      await assert.rejects(()=>invoke(actions,source('later'),'local_change',{value:'x'}),/admission closed/);assert.equal(effects,0);
    }finally{instance.close();}
  }
  {
    const {instance,actions}=fixture();try {
      instance.workActions().register(clockCapability(instance,async()=>{}));
      for(let n=1;n<=32;n++)assert.equal((await invoke(actions,n%2?guest(n):source(String(n)),'clock',{})).kind,'completed');
      assert.equal((await invoke(actions,guest(33),'clock',{})).kind,'blocked');
      await assert.rejects(()=>invoke(actions,source('after-limit'),'clock',{}),/admission closed/);
      assert.equal(instance.db.prepare('SELECT count(*) AS n FROM action_journal').get().n,32);
    }finally{instance.close();}
  }
});

test('uncertain task effect fences its retry until feature reconciliation',async()=>{
  const instance=new Instance(':memory:');try {
    const bot=instance.createBot({provider:'live',model:'fixture-offline',name:'Task',instructions:'',toolMode:'hybrid'});instance.acceptTask({id:'t1',botId:bot.id,objective:'work',limitMs:10000});instance.taskStart('t1');
    let calls=0;const cap=localChange({execute:async(input,work)=>{calls++;writeFileSync(join(work.workingDirectory,'fixture'),input.value);if(calls===1)throw Error('lost result');return input.value;}});
    cap.recovery={overlaps:()=>true,reconcile:(input,evidence,work)=>evidence==='inspected' && readFileSync(join(work.workingDirectory,'fixture'),'utf8')===input.value};
    instance.workActions().register(cap);const one=instance.workActions().open({kind:'task',id:'t1'},new AbortController().signal);
    const result=await invoke(one,guest(1),'local_change',{value:'x'});assert.equal(result.action.state,'uncertain');instance.taskFinish('t1','failed','lost result');
    instance.acceptTask({id:'t2',botId:bot.id,objective:'work',limitMs:10000,predecessor:'t1'});instance.taskStart('t2');const two=instance.workActions().open({kind:'task',id:'t2'},new AbortController().signal);
    assert.equal((await invoke(two,source('retry'),'local_change',{value:'y'})).kind,'blocked');assert.equal(calls,1);
    await assert.rejects(()=>two.reconcile(result.action.id,'declared-new'),/reconciliation/);await two.reconcile(result.action.id,'inspected');
    assert.equal((await invoke(two,source('after-review'),'local_change',{value:'y'})).kind,'completed');assert.equal(calls,2);
  }finally{instance.close();}
});

test('actual restart marks started task effect uncertain and never reruns it',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'staf-actions-restart-')),path=join(dir,'instance.sqlite');let instance;
  try {
    instance=new Instance(path);const bot=instance.createBot({provider:'live',model:'fixture-offline',name:'Restart',instructions:'',toolMode:'hybrid'});
    instance.acceptTask({id:'before',botId:bot.id,objective:'work',limitMs:10000});instance.taskStart('before');
    let entered;const started=new Promise(resolve=>{entered=resolve;});let executions=0;
    const cap=localChange({execute:async(input,work)=>{executions++;writeFileSync(join(work.workingDirectory,'fixture'),input.value);entered();return await new Promise(()=>{});}});
    instance.workActions().register(cap);const first=instance.workActions().open({kind:'task',id:'before'},new AbortController().signal);
    void invoke(first,guest(1),'local_change',{value:'x'});await started;
    assert.equal(instance.db.prepare('SELECT state FROM action_journal').get().state,'started');instance.close();
    instance=new Instance(path);instance.workActions().register(cap);
    assert.equal(instance.db.prepare('SELECT state FROM action_journal').get().state,'uncertain');
    instance.acceptTask({id:'after',botId:bot.id,objective:'work',limitMs:10000,predecessor:'before'});instance.taskStart('after');
    const retry=instance.workActions().open({kind:'task',id:'after'},new AbortController().signal);
    assert.equal(retry.manifest().actions[0].state,'uncertain');assert.equal((await invoke(retry,source('retry'),'local_change',{value:'x'})).kind,'blocked');
    assert.equal(executions,1);assert.equal(readFileSync(join(retry.context.workingDirectory,'fixture'),'utf8'),'x');
  }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('version 31 migration backfills accepted bindings with a protected backup',()=>{
  const dir=mkdtempSync(join(tmpdir(),'staf-actions-migration-')),path=join(dir,'instance.sqlite');let instance;
  try {
    instance=new Instance(path);const bot=instance.createBot({provider:'live',model:'fixture-offline',name:'Legacy',instructions:'',toolMode:'hybrid'});instance.claim({id:'legacy',botId:bot.id,content:'hi'});
    const directory=instance.workContext({kind:'command',id:'legacy'},new AbortController().signal).workingDirectory;writeFileSync(join(directory,'kept'),'kept');instance.close();
    const db=new DatabaseSync(path);db.exec('DROP TABLE work_action_resolutions; DROP TABLE work_action_challenges; DROP TABLE work_action_requests; DROP TABLE work_action_invocations; DROP TABLE work_action_state; DROP TABLE work_bindings; PRAGMA user_version=31');db.close();
    instance=new Instance(path);assert.ok(instance.migrationBackup && existsSync(instance.migrationBackup));
    assert.equal(instance.workContext({kind:'command',id:'legacy'},new AbortController().signal).workingDirectory,directory);
    assert.equal(readFileSync(join(directory,'kept'),'utf8'),'kept');
  }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('a new command can intentionally make the same change',async()=>{
  const {instance,bot,actions}=fixture();try {
    instance.workActions().register(localChange());assert.equal((await invoke(actions,source('first'),'local_change',{value:'x'})).value,'x');
    instance.completeMemoryCommand('c',null,'done');instance.claim({id:'next',botId:bot.id,content:'again'});
    const next=instance.workActions().open({kind:'command',id:'next'},new AbortController().signal);
    assert.equal((await invoke(next,source('again'),'local_change',{value:'x'})).value,'xx');
  }finally{instance.close();}
});

test('live clock restrictions and Stop are checked after asynchronous authorization',async()=>{
  for(const restriction of ['clock','stop']) {
    const {instance,actions}=fixture();try {
      let release,entered;const waiting=new Promise(resolve=>{entered=resolve;});const gate=new Promise(resolve=>{release=resolve;});
      instance.workActions().register(clockCapability(instance,async()=>{entered();await gate;}));
      const call=invoke(actions,source('held'),'clock',{});await waiting;
      if(restriction==='clock')instance.setApprovalSettings('instance','ask-for-risky-actions',false);else instance.requestResponseStop('c');
      release();assert.equal((await call).kind,'blocked');assert.equal(instance.db.prepare('SELECT state FROM action_journal').get().state,'cancelled');
    }finally{instance.close();}
  }
});

test('inspection retains only the capability safe result and refreshes stale repeat challenges',async()=>{
  const {instance,actions}=fixture();try {
    instance.workActions().register(localChange());const first=await invoke(actions,guest(1),'local_change',{value:'private'});
    assert.equal(actions.manifest().actions[0].result,'Fixture updated');assert.equal(first.value,'private');
    actions.beginRecovery();const challenge=await invoke(actions,source('request'),'local_change',{value:'private'});
    const repeated=await invoke(actions,source('repeat'),'local_change',{value:'private'},{kind:'repeat',challenge:challenge.challenge});assert.equal(repeated.value,'privateprivate');
    const refreshed=await invoke(actions,source('request'),'local_change',{value:'private'});assert.notEqual(refreshed.challenge,challenge.challenge);assert.equal(refreshed.actions.length,2);
    await assert.rejects(()=>invoke(actions,source('request'),'local_change',{value:'changed'}),/conflicts/);
  }finally{instance.close();}
});

test('Stop after an effect withholds its result while retaining the observed outcome',async()=>{
  const {instance,controller,actions}=fixture();try {
    let release,entered;const waiting=new Promise(resolve=>{entered=resolve;});const gate=new Promise(resolve=>{release=resolve;});
    instance.workActions().register(localChange({execute:async()=>{entered();await gate;return 'private';}}));
    const result=invoke(actions,guest(1),'local_change',{value:'x'});await waiting;controller.abort();release();await assert.rejects(result);
    assert.equal(instance.db.prepare('SELECT state,result FROM action_journal').get().state,'succeeded');
    assert.equal(actions.manifest().actions[0].result,'Fixture updated');
  }finally{instance.close();}
});

test('a repeat challenge can start only one action even with concurrent callers',async()=>{
  const {instance,actions}=fixture();try {
    instance.workActions().register(localChange());await invoke(actions,guest(1),'local_change',{value:'x'});actions.beginRecovery();
    const challenge=await invoke(actions,source('question'),'local_change',{value:'x'});
    const outcomes=await Promise.allSettled([invoke(actions,source('a'),'local_change',{value:'x'},{kind:'repeat',challenge:challenge.challenge}),invoke(actions,source('b'),'local_change',{value:'x'},{kind:'repeat',challenge:challenge.challenge})]);
    assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,1);assert.equal(outcomes.filter(item=>item.status==='rejected').length,1);
    assert.equal(readFileSync(join(actions.context.workingDirectory,'fixture'),'utf8'),'xx');
    assert.equal(instance.db.prepare('SELECT count(*) AS n FROM action_journal').get().n,2);
  }finally{instance.close();}
});

test('recovery fences different changes after a completed opaque effect',async()=>{
  const {instance,actions}=fixture();try {
    const cap=localChange();cap.recovery={overlaps:()=>true,reconcile:(input,evidence,work)=>evidence==='inspected' && readFileSync(join(work.workingDirectory,'fixture'),'utf8')===input.value};instance.workActions().register(cap);
    const first=await invoke(actions,guest(1),'local_change',{value:'x'});actions.beginRecovery();
    const blocked=await invoke(actions,source('different'),'local_change',{value:'y'});assert.match(blocked.reason,/opaque/i);
    await actions.reconcile(first.actionId,'inspected');assert.equal((await invoke(actions,source('reviewed'),'local_change',{value:'y'})).value,'xy');
  }finally{instance.close();}
});

test('unregistered uncertain journal effects conservatively fence a task retry',async()=>{
  const {ActionJournal}=await import('../dist/action-journal.js');const instance=new Instance(':memory:');try {
    const bot=instance.createBot({provider:'live',model:'fixture-offline',name:'Legacy task',instructions:'',toolMode:'hybrid'});instance.acceptTask({id:'old',botId:bot.id,objective:'work',limitMs:10000});instance.taskStart('old');
    const journal=new ActionJournal(instance.db);const prepared=journal.prepare({id:'old-action',fingerprint:'keyed-fingerprint',work:{kind:'task',id:'old'},summary:'Legacy effect'});journal.start(prepared.permit);journal.finish('old-action','uncertain','Outcome unknown');instance.taskFinish('old','failed','interrupted');
    instance.acceptTask({id:'retry',botId:bot.id,objective:'work',limitMs:10000,predecessor:'old'});instance.taskStart('retry');instance.workActions().register(localChange());
    const actions=instance.workActions().open({kind:'task',id:'retry'},new AbortController().signal);
    assert.equal(actions.manifest().actions[0].id,'old-action');assert.match((await invoke(actions,source('new'),'local_change',{value:'x'})).reason,/reconciliation/);
  }finally{instance.close();}
});

test('a feature can report a definite failure without calling it uncertain',async()=>{
  const {ActionFailed}=await import('../dist/work-actions.js');const {instance,actions}=fixture();try {
    instance.workActions().register(localChange({execute:async()=>{throw new ActionFailed('Fixture rejected the change');}}));
    const result=await invoke(actions,guest(1),'local_change',{value:'x'});assert.equal(result.action.state,'failed');assert.equal(result.action.result,'Fixture rejected the change');
  }finally{instance.close();}
});

test('queued invocations keep the input supplied when they entered the coordinator',async()=>{
  const {instance,actions}=fixture();try {
    let release,entered;const waiting=new Promise(resolve=>{entered=resolve;});const gate=new Promise(resolve=>{release=resolve;});let authorizations=0;
    instance.workActions().register(localChange({authorize:async()=>{if(++authorizations===1){entered();await gate;}}}));
    const first=invoke(actions,guest(1),'local_change',{value:'a'});await waiting;
    const request={source:source('queued'),name:'local_change',input:{value:'b'},intent:{kind:'new'}};const second=actions.invoke(request);request.input.value='changed';release();
    assert.equal((await first).value,'a');assert.equal((await second).value,'ab');
  }finally{instance.close();}
});

test('captured modes enforce direct and guest routes at dispatch',async()=>{
  const instance=new Instance(':memory:');try {
    instance.workActions().register(clockCapability(instance,async()=>{}));
    for(const mode of ['direct','hybrid','code']) {
      const bot=instance.createBot({provider:'live',model:'fixture-offline',name:mode,instructions:'',toolMode:mode});instance.claim({id:mode,botId:bot.id,content:'hi'});
      const actions=instance.workActions().open({kind:'command',id:mode},new AbortController().signal);
      assert.equal(actions.offers('direct').length,mode==='code'?0:1);assert.equal(actions.offers('guest').length,mode==='direct'?0:1);
      if(mode==='code')await assert.rejects(()=>invoke(actions,source('direct'),'clock',{}),/not offered/);
      if(mode==='direct')await assert.rejects(()=>invoke(actions,guest(1),'clock',{}),/not offered/);
    }
  }finally{instance.close();}
});

test('a retry cannot overlap a predecessor effect that is still settling',async()=>{
  const instance=new Instance(':memory:');try {
    const bot=instance.createBot({provider:'live',model:'fixture-offline',name:'Settling',instructions:'',toolMode:'hybrid'});instance.acceptTask({id:'first',botId:bot.id,objective:'work',limitMs:10000});instance.taskStart('first');
    let release,entered;const waiting=new Promise(resolve=>{entered=resolve;});const gate=new Promise(resolve=>{release=resolve;});let effects=0;
    instance.workActions().register(localChange({execute:async()=>{effects++;entered();await gate;return 'done';}}));
    const first=instance.workActions().open({kind:'task',id:'first'},new AbortController().signal);const settling=invoke(first,guest(1),'local_change',{value:'x'});await waiting;
    instance.taskFinish('first','failed','effect still settling');instance.acceptTask({id:'retry',botId:bot.id,objective:'work',limitMs:10000,predecessor:'first'});instance.taskStart('retry');
    const retry=instance.workActions().open({kind:'task',id:'retry'},new AbortController().signal);assert.equal((await invoke(retry,source('new'),'local_change',{value:'y'})).kind,'blocked');assert.equal(effects,1);
    release();await assert.rejects(settling);
  }finally{instance.close();}
});

test('a feature can reconcile without providing an overlap hook',async()=>{
  const {instance,actions}=fixture();try {
    let calls=0;const cap=localChange({execute:async()=>{calls++;if(calls===1)throw Error('unknown');return 'ok';}});
    cap.recovery={reconcile:(_input,evidence)=>evidence==='verified'};instance.workActions().register(cap);
    const first=await invoke(actions,guest(1),'local_change',{value:'x'});assert.equal(first.action.state,'uncertain');
    assert.equal((await invoke(actions,source('blocked'),'local_change',{value:'y'})).kind,'blocked');
    await actions.reconcile(first.action.id,'verified');assert.equal((await invoke(actions,source('after'),'local_change',{value:'y'})).kind,'completed');
  }finally{instance.close();}
});

test('asynchronous reconciliation waits for evidence and rechecks work authority',async()=>{
 const {instance,actions,controller}=fixture();let release;
 try {
  const gate=new Promise(resolve=>{release=resolve;});const cap=localChange({execute:async()=>{throw Error('uncertain');}});
  cap.recovery={reconcile:async()=>{await gate;return true;}};instance.workActions().register(cap);
  const first=await invoke(actions,source('async-effect'),'local_change',{value:'x'});
  const pending=actions.reconcile(first.action.id,'evidence');
  assert.deepEqual(actions.manifest().resolutions,[]);controller.abort();release();
  await assert.rejects(pending);assert.deepEqual(actions.manifest().resolutions,[]);
 } finally {release?.();actions.dispose();instance.close();}
});

test('explicit shared closure rejects queued and later calls on both routes',async()=>{
  const {instance,actions}=fixture();let release;
  try {
    let entered;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);let effects=0;
    instance.workActions().register(localChange({authorize:async()=>{entered();await gate;},execute:async()=>{effects++;return 'done';}}));
    const first=invoke(actions,guest(1),'local_change',{value:'x'});await ready;
    const second=invoke(actions,source('queued'),'local_change',{value:'y'});actions.close('guest limit');release();
    assert.equal((await first).kind,'blocked');await assert.rejects(second,/admission closed/);
    await assert.rejects(()=>invoke(actions,guest(2),'local_change',{value:'z'}),/admission closed/);assert.equal(effects,0);
  } finally {release?.();instance.close();}
});
