import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';

for (const outcome of ['completed','failed','stopped']) {
  test(`chat retains ordered tool calls and intermediate messages after ${outcome} and restart`,async()=>{
    const dir=mkdtempSync(join(tmpdir(),'staf-chat-timeline-')),path=join(dir,'instance.sqlite');
    let round=0,entered;
    const waiting=new Promise(resolve=>{entered=resolve});
    let app=startInstance(path,0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(_messages,_tools,{signal}){
      round++;
      if(round<3)return {role:'assistant',content:round===1?null:'First result checked.',tool_calls:[{id:'call-'+round,type:'function',function:{name:'clock',arguments:'{}'}}]};
      if(outcome==='failed')throw Error('Fixture failure');
      if(outcome==='stopped'){entered();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));signal.throwIfAborted();}
      return {role:'assistant',content:'Final result checked.'};
    }})}),port=await app.listen();
    const call=async(route,token,body)=>{
      const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
      assert.equal(response.ok,true,await response.clone().text());return response.json();
    };
    try {
      const token=(await call('/api/pair','',{code:app.code})).token;
      const bot=await call('/api/bots',token,{name:'Timeline',provider:'live',model:'fixture-offline',toolMode:'direct'});
      await call('/api/commands',token,{id:'timeline',botId:bot.id,content:'Check twice.'});
      if(outcome==='stopped'){await waiting;await call('/api/commands/timeline/stop',token,{});}
      let command;
      for(let i=0;i<200;i++){command=await call('/api/commands/timeline',token);if(command.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
      assert.equal(command.state,outcome);
      const work=(await call(`/api/bots/${bot.id}/chat-work`,token)).requests[0];
      assert.deepEqual(work.events.map(event=>event.type),['tool_start','tool_result','assistant_message','tool_start','tool_result']);
      assert.equal(work.events[2].detail,'First result checked.');
      assert.equal(command.runtimeEvents.length,4,'CLI tool summaries contain only tool events');
      assert.equal(work.events[0].callId,work.events[1].callId);
      assert.equal(work.events[3].callId,work.events[4].callId);
      await app.close();app=startInstance(path,0,{env:{}});port=await app.listen();
      assert.deepEqual((await call(`/api/bots/${bot.id}/chat-work`,token)).requests[0].events,work.events);
    } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
  });
}
