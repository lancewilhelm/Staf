import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {startInstance} from '../dist/instance-service.js';
import {applicationCapability,dataSchema,resourceScope,scopeClaim} from '../dist/code-mode/contract.js';
import {z} from 'zod';

const directory='.staf/code-mode-review';mkdirSync(directory,{recursive:true});
const schema=dataSchema(z.strictObject({value:z.string()}));
const capability=applicationCapability({description:'Uppercase synthetic text',input:schema,output:schema,effect:{kind:'read',resource:call=>resourceScope({family:'demo',owner:call.context.botId,key:call.context.sessionId})},checkScope:async()=>scopeClaim(()=>undefined),invoke:async(call,input)=>({value:input.value.toUpperCase()})});
const app=startInstance(`${directory}/instance.sqlite`,0,{env:{},codeModeLab:{capabilities:{'demo.read':capability},policy:()=> 'prompt'},providerFactory:async()=>({name:'synthetic-code-demo',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(messages,tools){
  const last=messages.at(-1);
  if(last.role==='tool')return {role:'assistant',content:last.content};
  return {role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:'execute_code',arguments:JSON.stringify({source:'const result=await capabilities["demo.read"]({value:"hello"}); await staf.emit({partial:result.value}); return {answer:result.value+"!"};'})}}]};
}})});
const port=await app.listen();
const call=async(route,token,body)=>{
  const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const result=await response.json();if(!response.ok)throw Error(JSON.stringify(result));return result;
};
try {
  const a=(await call('/api/pair','',{code:app.code})).token;
  const b=(await call('/api/pair','',{code:app.issueCode()})).token;
  const bot=await call('/api/bots',a,{name:'Code Mode review'}),commandId=randomUUID();
  await call('/api/commands',a,{id:commandId,botId:bot.id,content:'Run the synthetic code demo'});
  let approval;
  for(let i=0;i<300&&!approval;i++){approval=(await call('/api/code-approvals',b))[0];if(!approval)await delay(10);}
  if(!approval)throw Error('No approval arrived');
  console.log('Synthetic provider only. Exact action from the first client:');
  console.log(JSON.stringify({name:approval.name,input:approval.input,effect:approval.effect},null,2));
  let answer=process.argv.includes('--approve')?'approve':process.argv.includes('--deny')?'deny':process.argv.includes('--stop')?'stop':undefined;
  if(!answer){const prompt=createInterface({input:process.stdin,output:process.stdout});try{answer=(await prompt.question('From the second paired client, choose approve, deny, or stop: ')).trim();}finally{prompt.close();}}
  if(!['approve','deny','stop'].includes(answer))throw Error('Choose approve, deny, or stop');
  if(answer==='stop')await call(`/api/commands/${commandId}/stop`,b,{});
  else await call(`/api/code-approvals/${approval.id}/${answer}`,b,{});
  let command;
  for(let i=0;i<300;i++){command=await call(`/api/commands/${commandId}`,a);if(command.state!=='pending')break;await delay(10);}
  const history=await call(`/api/commands/${commandId}/code-mode`,a);
  writeFileSync(`${directory}/history.json`,JSON.stringify(history,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({command:command.state,outputs:history.events.filter(e=>e.kind==='output').map(e=>e.value),actions:history.actions.map(a=>a.state)},null,2));
  console.log(`Full retained source and history: ${directory}/history.json`);
} finally {await app.close();}
