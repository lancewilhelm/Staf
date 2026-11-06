import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { startInstance } from '../../dist/instance-service.js';
import { demoProvider } from '../fixtures/echo-provider.mjs';

const [path, port] = process.argv.slice(2);
let now = Date.parse('2024-03-01T11:59:00Z');
Date.now = () => now;
const originalInterval = globalThis.setInterval;
globalThis.setInterval = (callback, delay, ...args) => originalInterval(callback, delay === 30000 ? 100 : delay, ...args);
const webDependencies={resolve:async host=>{console.log('SCHEDULE_WEB dns '+host);return [{address:'8.8.8.8',family:4}];},request:async url=>{console.log('SCHEDULE_WEB request '+url.hostname);return {status:302,headers:{location:'https://other.example/redirect'},body:(async function*(){yield Buffer.from('')})(),close(){}};}};
const providerFactory=async()=>{let calls=0;return {name:'scheduled-web-fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(messages,tools,options){if(options?.currentUserInput==='Run scheduled scratch'){if(calls<3){if(!tools.some(t=>t.function.name==='run_scratch_shell'))throw Error('Scheduled shell tool missing');const command=calls===0?'printf changed':'printf synthetic';return {role:'assistant',content:null,tool_calls:[{id:'scratch-'+calls++,type:'function',function:{name:'run_scratch_shell',arguments:JSON.stringify({command})}}]};}return {role:'assistant',content:'Scheduled scratch settled'};}if(options?.currentUserInput==='Find scheduled report'){if(calls<3){if(!tools.some(t=>t.function.name==='search_web'))throw Error('Scheduled search tool missing');const query=calls===0?'different query':'synthetic maps';return {role:'assistant',content:null,tool_calls:[{id:'search-'+calls++,type:'function',function:{name:'search_web',arguments:JSON.stringify({query})}}]};}return {role:'assistant',content:'Scheduled search settled'};}if(options?.currentUserInput==='Fetch scheduled report'){if(calls++===0){if(!tools.some(t=>t.function.name==='read_web'))throw Error('Scheduled web tool missing');return {role:'assistant',content:null,tool_calls:[{id:'scheduled-read',type:'function',function:{name:'read_web',arguments:JSON.stringify({url:'https://one.example/report'})}}]};}return {role:'assistant',content:'Scheduled web settled'};}return demoProvider.complete(messages,tools,options);}}};
const searchBackend=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;console.log('SCHEDULE_SEARCH_REQUEST '+req.method+' '+req.url+' '+body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({results:[{title:'Synthetic report',url:'https://example.test/report',content:'Local fixture'}]}));});
await new Promise(resolve=>searchBackend.listen(0,'127.0.0.1',resolve));console.log('SCHEDULE_SEARCH_ORIGIN http://127.0.0.1:'+searchBackend.address().port);
const shellExecutor=async request=>{const {signal,...details}=request;console.log('SCHEDULE_SHELL_EXEC '+JSON.stringify(details));return {output:'Synthetic scheduled shell output',exitCode:0,outputComplete:true,stopped:'completed'};};
const app = startInstance(path, Number(port), { env: {},webDependencies,providerFactory,shellExecutor });
await app.listen();
console.log(`Listening on http://127.0.0.1:${port}\nPairing code: ${app.code}`);
createInterface({input:process.stdin}).on('line', line => {
  if (line === 'due') now = Date.parse('2024-03-01T12:00:00Z');
  else if(line === 'due-web') now = Date.parse('2024-03-01T12:01:00Z');
  else if(line === 'due-search') now = Date.parse('2024-03-01T12:02:00Z');
  else if(line === 'due-shell') now = Date.parse('2024-03-01T12:03:00Z');
  else console.log(`Pairing code: ${app.issueCode()}`);
});
