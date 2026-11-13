import test from 'node:test';
import assert from 'node:assert/strict';
import { startInstance } from './fixtures/controlled-instance.mjs';

test('agent pipe and PTY processes do not inherit supported credential variables', async () => {
  const names=['OPENROUTER_API_KEY','STAF_API_KEY','OPENAI_API_KEY','CODEX_API_KEY','LMSTUDIO_API_KEY'];
  const prior=Object.fromEntries([...names,'STAF_TEST_ORDINARY'].map(name=>[name,process.env[name]]));
  for(const name of names)process.env[name]='synthetic-private-value';
  process.env.STAF_TEST_ORDINARY='available';
  let mode='pipe';
  const script=`const names=${JSON.stringify(names)};process.stdout.write(JSON.stringify({present:names.filter(n=>Object.hasOwn(process.env,n)),ordinary:process.env.STAF_TEST_ORDINARY}))`;
  const command=`${JSON.stringify(process.execPath)} -e '${script}'`;
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:{role:'assistant',content:null,tool_calls:[{id:'terminal',type:'function',function:{name:'terminal_run',arguments:JSON.stringify({command,mode,retain:true})}}]};}})});
  try {
    const port=await app.listen();let token;
    const call=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
    token=(await call('/api/pair',{code:app.code})).token;
    const bot=await call('/api/bots',{provider:'live',model:'fixture-offline',name:'environment',toolMode:'direct'});
    for(mode of ['pipe','pty']) {
      const id=`env-${mode}`;await call('/api/commands',{id,botId:bot.id,content:'Run fixture'});
      let processRecord;
      for(let i=0;i<500;i++){processRecord=(await call('/api/processes')).find(p=>p.work.id===id && p.outputComplete);if(processRecord)break;await new Promise(resolve=>setTimeout(resolve,10));}
      assert.ok(processRecord,`timed out: ${mode}`);assert.equal(processRecord.exitCode,0);
      const page=await call(`/api/processes/${processRecord.id}/output`);
      const output=page.chunks.map(chunk=>Buffer.from(chunk.data,'base64').toString()).join('');
      assert.deepEqual(JSON.parse(output),{present:[],ordinary:'available'},mode);
    }
  } finally {
    await app.close();
    for(const [name,value] of Object.entries(prior))if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
});
