import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../../dist/instance-service.js';

// Disposable offline workspace for reviewing the protected request UI.
const directory=mkdtempSync(join(tmpdir(),'staf-secret-ui-'));
const app=startInstance(join(directory,'instance.sqlite'),3211,{dataDir:directory,env:{},providerFactory:async()=>({
 name:'offline-fixture',capabilities:{toolCalls:true},async complete(messages){
  if(messages.at(-1)?.role==='tool')return {role:'assistant',content:'The secret request has finished. Saving does not connect a service.'};
  return {role:'assistant',content:null,tool_calls:[{id:'secret-request',type:'function',function:{name:'request_secret',arguments:JSON.stringify({name:'Example credential',purpose:'Demonstrate protected entry',destination:'example.test'})}}]};
 }
})});
try {await app.listen();console.log(`Offline workspace: http://127.0.0.1:3211/\nPairing code: ${app.code}\nCreate an agent with provider live and model fixture-offline, then send any message. Use synthetic values only. Press Ctrl-C to remove this disposable workspace.`);}
catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
let stopping=false;
async function stop(){if(stopping)return;stopping=true;try{await app.close();}finally{rmSync(directory,{recursive:true,force:true});}}
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
