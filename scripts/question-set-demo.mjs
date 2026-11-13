// Disposable, synthetic-only manual fixture. The browser talks to a real local service.
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startInstance} from '../dist/instance-service.js';

const directory=mkdtempSync(join(tmpdir(),'staf-question-demo-'));
const path=join(directory,'instance.sqlite');
const questions=[{kind:'single',prompt:'Which format do you prefer?',choices:['Short','Detailed']},{kind:'multiple',prompt:'Which topics interest you?',choices:['Projects','Planning']},{kind:'text',prompt:'What else should I know?'}];
const providerFactory=async profile=>({name:'synthetic',capabilities:{toolCalls:true},async complete(messages,_tools,options){
  const input=options.currentUserInput ?? '',turn=messages.slice(messages.findLastIndex(message=>message.role==='user')+1);
  if(input==='Ask a set' && !turn.some(message=>message.role==='tool')) {
    const code=profile.toolMode==='code',name=code?'code_mode':'ask_questions';
    const args=code?{source:`return await capabilities.ask_questions(${JSON.stringify({questions})});`}:{questions};
    return {role:'assistant',content:null,tool_calls:[{id:'fixture-question',type:'function',function:{name,arguments:JSON.stringify(args)}}]};
  }
  return {role:'assistant',content:input.includes('Owner response to question set')?'I received your response.':'The synthetic agent is ready.'};
}});
let app=startInstance(path,0,{dataDir:directory,env:{},providerFactory}),port=await app.listen();
const call=async(pathname,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${pathname}`,{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(`Fixture setup failed: ${r.status}`);return r.json();};
const {token}=await call('/api/pair','',{code:app.code});
await call('/api/bots',token,{name:'Synthetic agent',provider:'live',model:'fixture',toolMode:'direct'});
console.log(`Open http://127.0.0.1:${port}/ and pair with code ${app.issueCode()}.`);
console.log('Send “Ask a set”. Type r and Enter here to restart the service; Ctrl-C deletes the disposable fixture data.');
let running=false;
process.stdin.setEncoding('utf8');process.stdin.on('data',async chunk=>{if(chunk.trim()!=='r'||running)return;running=true;try{await app.close();app=startInstance(path,port,{dataDir:directory,env:{},providerFactory});await app.listen();console.log('Service restarted. Refresh the browser.');}catch(error){console.error('Restart failed:',error);process.exitCode=1;}finally{running=false;}});
async function stop(){if(running)return;running=true;await app.close();rmSync(directory,{recursive:true,force:true});process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
