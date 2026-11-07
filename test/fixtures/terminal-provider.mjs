import {createServer} from 'node:http';
import {writeFileSync,renameSync} from 'node:fs';

// A loopback Chat Completions endpoint used only by disposable terminal tests.
const server=createServer(async(req,res)=>{
 if(req.method==='GET' && req.url==='/v1/models'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'fixture-offline',name:'Controlled fixture'}]}));return;}
 let body='';for await(const chunk of req)body+=chunk;
 const request=JSON.parse(body),messages=request.messages.filter(message=>message.role!=='system');
 const last=messages.at(-1);const current=typeof last?.content==='string'?last.content.split('\n\nUser message:\n').at(-1).split('\n\n')[0]:'';let message;
 if(last?.role==='tool') message={role:'assistant',content:`Demo tool result: ${last.content}`};
 else if(/\btime\b/i.test(current))message={role:'assistant',content:null,tool_calls:[{id:'clock-demo',type:'function',function:{name:'clock',arguments:'{}'}}]};
 else message={role:'assistant',content:`Demo (offline): ${current}. User turns saved: ${messages.filter(m=>m.role==='user').length}. Ask "what time is it?" to see a tool call.`};
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message}]}));
});
server.listen(0,'127.0.0.1',()=>{const temporary=process.argv[2]+'.tmp';writeFileSync(temporary,JSON.stringify({pid:process.pid,port:server.address().port}));renameSync(temporary,process.argv[2]);});
process.on('SIGTERM',()=>server.close(()=>process.exit()));
