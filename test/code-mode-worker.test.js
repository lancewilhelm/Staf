import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startQuickJSGuest} from '../dist/code-mode/executor.js';

function run(source, request) {
  return startQuickJSGuest({source,names:['clock'],guestMs:5000,request,phase:()=>{}});
}

test('real QuickJS worker calls the host and returns its result', async () => {
  const requests=[];
  const guest=run('return await capabilities.clock({});',async message=>{
    requests.push(message);
    return {ok:true,value:'2026-01-01T00:00:00.000Z'};
  });
  const result=await guest.finished;
  assert.equal(result.outcome,'return');
  assert.equal(result.value,'2026-01-01T00:00:00.000Z');
  assert.deepEqual(requests,[{type:'call',seq:1,name:'clock',input:{}}]);
});

test('real QuickJS worker reports script errors and can be stopped', async () => {
  const broken=run('throw Error("test")',async()=>({ok:false,error:'unexpected'}));
  assert.equal((await broken.finished).outcome,'error');
  const stopped=run('while (true) {}',async()=>({ok:false,error:'unexpected'}));
  stopped.stop();
  assert.equal((await stopped.finished).outcome,'stopped');
});

test('guest CPU exhaustion is distinct from an ordinary script error', async () => {
  const guest=startQuickJSGuest({source:'while (true) {}',names:[],guestMs:50,request:async()=>({ok:false,error:'unexpected'}),phase:()=>{}});
  assert.equal((await guest.finished).outcome,'limit');
});

test('a rejected intent does not consume the next host call sequence', async () => {
  const requests=[];
  const guest=run('try { await capabilities.clock({}, {kind:"invalid"}); } catch {} return await capabilities.clock({});',async request=>{requests.push(request);return {ok:true,value:'ok'};});
  assert.equal((await guest.finished).outcome,'return');assert.equal(requests.length,1);assert.equal(requests[0].seq,1);
});

test('observed host stack exhaustion closes the guest', async () => {
  const guest=run('function recurse(){ return recurse(); } return recurse();',async()=>({ok:false,error:'unexpected'}));
  assert.equal((await guest.finished).outcome,'limit');
});

test('the QuickJS allocation guard rejects a request larger than its configured capacity', async () => {
  const guest=startQuickJSGuest({source:'new ArrayBuffer(8*1024*1024); return "unexpected";',names:[],guestMs:5000,heapBytes:4*1024*1024,request:async()=>({ok:false,error:'unexpected'}),phase:()=>{}});
  assert.equal((await guest.finished).outcome,'error');
});

test('actual JSON bounds close the guest even if its program catches the error', async () => {
  for(const source of ['return "x".repeat(300000);','try { await staf.emit("x".repeat(300000)); } catch {} return "caught";']) {
    const guest=run(source,async()=>({ok:true,value:null}));
    assert.equal((await guest.finished).outcome,'limit');
  }
});
