import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { NativeProcesses, nativeProcessSchema } from '../dist/native-processes.js';

function setup() {
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE action_journal (id TEXT PRIMARY KEY)');db.exec(nativeProcessSchema);db.prepare('INSERT INTO action_journal VALUES (?)').run('action');
  const controller=new AbortController();
  return {db,controller,manager:new NativeProcesses(db),work:{botId:'bot',work:{kind:'command',id:'work'},workingDirectory:process.cwd(),signal:controller.signal}};
}

test('Stop during starting reaches the real child when its handle becomes ready',async()=>{
  const {db,controller,manager,work}=setup();let child,requested=false;
  const backend={launch(_cwd,observer){
    child=spawn('sleep',['30'],{stdio:'ignore'});
    child.once('spawn',()=>{observer.started(child.pid);if(requested)child.kill('SIGTERM');});
    child.once('exit',(code,signal)=>observer.exited(code,signal));child.once('close',(code,signal)=>observer.closed(code,signal));
    return {terminate(signal){if(child.pid)child.kill(signal);else requested=true;},detach(){child.removeAllListeners();}};
  }};
  try {
    const starting=manager.startBackend(work,{id:'action',fingerprint:'fixture'},{mode:'pipe',backend});
    const initial=manager.list()[0];assert.equal(initial.state,'starting');controller.abort();
    const result=await starting;assert.equal(result.stopRequested,true);
    for(let i=0;i<300 && manager.get(initial.id).state!=='exited';i++)await new Promise(resolve=>setTimeout(resolve,10));
    const ended=manager.get(initial.id);assert.equal(ended.state,'exited');assert.equal(ended.exitSignal,'SIGTERM');assert.notEqual(child.signalCode,null);
  } finally {if(child && child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');await manager.shutdown();db.close();}
});

test('graceful shutdown records unknown when a real child exit is not observed',async()=>{
  const {db,manager,work}=setup();let child,closed;
  const backend={launch(_cwd,observer){
    child=spawn('sleep',['30'],{stdio:'ignore'});closed=once(child,'close');child.once('spawn',()=>observer.started(child.pid));
    return {terminate(signal){child.kill(signal);},detach(){}};
  }};
  try {
    const started=await manager.startBackend(work,{id:'action',fingerprint:'fixture'},{mode:'pipe',backend});assert.equal(started.state,'running');
    await manager.shutdown();await closed;
    const record=manager.get(started.id);assert.equal(record.state,'unknown');assert.equal(record.outputComplete,false);assert.equal(record.stopRequested,true);assert.equal(child.signalCode,'SIGTERM');
  } finally {if(child && child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');db.close();}
});
