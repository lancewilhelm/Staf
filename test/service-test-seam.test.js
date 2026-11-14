import {strict as assert} from 'node:assert';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {startInstance,startControlledInstance} from './fixtures/controlled-instance.mjs';

test('only an explicit in-process test dependency permits the controlled fixture',async()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-test-seam-'));let calls=0;
 try {
  for(const controlled of [false,true]) {
   const marker=join(root,controlled?'controlled':'closed');let observed='';
   const fakeOption={recheck(){calls++;},files(){calls++;throw Error('not selectable');},start(){calls++;throw Error('not selectable');}};
   const factory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){
    if(messages.at(-1)?.role==='tool'){observed=messages.at(-1).content;return {role:'assistant',content:'done'};}
    return {role:'assistant',content:null,tool_calls:[{id:'write',type:'function',function:{name:'file_write',arguments:JSON.stringify({path:marker,content:'synthetic'})}}]};
   }});
   const app=(controlled?startControlledInstance:startInstance)(join(root,controlled?'c.db':'d.db'),0,{env:{STAF_LINUX_HOST_EXECUTION:'0',STAF_TEST_HOST_WORK:'1',NODE_ENV:'test'},hostWork:fakeOption,providerFactory:factory});
   try {
    const port=await app.listen();let token;const call=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok);return response.json();};
    token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'Fixture',provider:'live',model:'fixture-offline',toolMode:'direct'});
    await call('/api/commands',{id:'fixture',botId:bot.id,content:'Write synthetic data'});
    let command;for(let i=0;i<500;i++){command=await call('/api/commands/fixture');if(command.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(command.state,'completed');
    if(controlled){assert.equal(readFileSync(marker,'utf8'),'synthetic');assert.equal(command.workActions[0].state,'succeeded');}
    else {assert.equal(existsSync(marker),false);assert.match(observed,/isolation is not established/);assert.equal(command.workActions.length,0);}
    assert.equal(calls,0,'configuration-like options must not supply the in-process dependency');
   } finally {await app.close();}
  }
 } finally {rmSync(root,{recursive:true,force:true});}
});
