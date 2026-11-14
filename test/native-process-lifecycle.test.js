import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { NativeProcesses, nativeProcessSchema } from '../dist/native-processes.js';
import {isolatedVisiblePath} from '../dist/linux-host-boundary.js';

function setup() {
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE action_journal (id TEXT PRIMARY KEY)');db.exec(nativeProcessSchema);db.prepare('INSERT INTO action_journal VALUES (?)').run('action');
  const controller=new AbortController();
  return {db,controller,manager:new NativeProcesses(db),work:{botId:'bot',work:{kind:'command',id:'work'},workingDirectory:process.cwd(),signal:controller.signal}};
}

test('isolated process records use the terminal-visible workspace path',async()=>{
 const {db,manager,work}=setup();const started=[];
 const backend={launch(cwd,observer){started.push(cwd);queueMicrotask(()=>{observer.started(1);observer.exited(0,null);observer.closed(0,null);});return {terminate(){},detach(){}};}};
 try {for(const input of ['/workspace/project','/srv/staf-workspace/project']) {const cwd=isolatedVisiblePath('/srv/staf-workspace',input);const result=await manager.startBackend(work,{id:'action',fingerprint:'fixture'},{baseCwd:'/workspace',cwd,mode:'pipe',backend});assert.equal(result.cwd,'/workspace/project');}assert.deepEqual(started,['/workspace/project','/workspace/project']);}finally{await manager.shutdown();db.close();}
});

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

test('Stop while the native supervisor is starting settles its real group',async()=>{
  const {db,controller,manager,work}=setup();
  try {
    const starting=manager.start(work,{id:'action',fingerprint:'fixture'},{command:'exec sleep 30'});
    const record=manager.list()[0];assert.equal(record.state,'starting');controller.abort();
    await starting;
    for(let i=0;i<500 && manager.handle(record.id);i++)await new Promise(resolve=>setTimeout(resolve,10));
    const ended=manager.get(record.id);assert.equal(ended.stopRequested,true);assert.equal(ended.state,'exited');assert.equal(ended.exitSignal,'SIGTERM');
    assert.throws(()=>process.kill(ended.pid,0),{code:'ESRCH'});
  } finally {await manager.shutdown();db.close();}
});
