import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startNativeLabGuest} from '../dist/code-mode/executor.js';

function run(source, request) {
  return startNativeLabGuest({source,names:['clock'],guestMs:5000,request,phase:()=>{}});
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
