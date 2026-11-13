import {startControlledInstance as startInstance} from './fixtures/controlled-instance.mjs';
const [database,command,mode='pipe']=process.argv.slice(2);
const app=startInstance(database,0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:{role:'assistant',content:null,tool_calls:[{id:'run',type:'function',function:{name:'terminal_run',arguments:JSON.stringify({command,mode,retain:true})}}]};}})});
const port=await app.listen();process.send({port,code:app.code});

process.on('message',async message=>{if(message==='shutdown'){await app.close();process.disconnect();}});
