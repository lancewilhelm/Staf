import { createInterface } from 'node:readline';
import { startInstance } from '../../dist/instance-service.js';

const [path, port] = process.argv.slice(2);
const factory=async()=>{
  let calls=0;
  return {name:'synthetic-docker-smoke',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(messages,tools){
    if(calls++===0){if(!tools.some(t=>t.function.name==='run_scratch_shell'))throw Error('Scratch tool not offered');return {role:'assistant',content:null,tool_calls:[{id:'smoke-shell',type:'function',function:{name:'run_scratch_shell',arguments:JSON.stringify({command:'printf STAF_DOCKER_SMOKE_OK'})}}]};}
    const tool=messages.at(-1)?.content ?? '';
    return {role:'assistant',content:tool.includes('STAF_DOCKER_SMOKE_OK')?'Observed actual scratch output: STAF_DOCKER_SMOKE_OK':'Scratch command did not complete'};
  }};
};
const app=startInstance(path,Number(port),{env:{},providerFactory:factory});await app.listen();
console.log(`Listening on http://127.0.0.1:${port}\nPairing code: ${app.code}`);
createInterface({input:process.stdin}).on('line',()=>console.log(`Pairing code: ${app.issueCode()}`));
