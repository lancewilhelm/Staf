import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {NativeProcesses,nativeProcessSchema} from '../dist/native-processes.js';

test('native process backends omit supported credential variables (mechanics only)', async () => {
  const names=['OPENROUTER_API_KEY','STAF_API_KEY','OPENAI_API_KEY','CODEX_API_KEY','LMSTUDIO_API_KEY'];
  const prior=Object.fromEntries([...names,'STAF_TEST_ORDINARY'].map(name=>[name,process.env[name]]));
  for(const name of names)process.env[name]='synthetic-private-value';
  process.env.STAF_TEST_ORDINARY='available';
  const script=`const names=${JSON.stringify(names)};process.stdout.write(JSON.stringify({present:names.filter(n=>Object.hasOwn(process.env,n)),ordinary:process.env.STAF_TEST_ORDINARY}))`;
  const command=`${JSON.stringify(process.execPath)} -e '${script}'`;
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE action_journal (id TEXT PRIMARY KEY)');db.exec(nativeProcessSchema);db.prepare('INSERT INTO action_journal VALUES (?)').run('action');
  const manager=new NativeProcesses(db),controller=new AbortController(),work={botId:'fixture',work:{kind:'command',id:'fixture'},workingDirectory:process.cwd(),signal:controller.signal,workSignal:controller.signal};
  try {
    for(const mode of ['pipe','pty']) {
      const started=await manager.start(work,{id:'action',fingerprint:'fixture'},{command,mode,retain:true});let processRecord;
      for(let i=0;i<500;i++){processRecord=manager.get(started.id);if(processRecord?.outputComplete)break;await new Promise(resolve=>setTimeout(resolve,10));}
      assert.ok(processRecord?.outputComplete,`timed out: ${mode}`);assert.equal(processRecord.exitCode,0);
      const page=manager.output(started.id);
      const output=page.chunks.map(chunk=>Buffer.from(chunk.data,'base64').toString()).join('');
      assert.deepEqual(JSON.parse(output),{present:[],ordinary:'available'},mode);
    }
  } finally {
    await manager.shutdown();db.close();
    for(const [name,value] of Object.entries(prior))if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
});
