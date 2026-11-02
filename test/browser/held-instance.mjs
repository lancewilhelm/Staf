import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { startInstance } from '../../dist/instance-service.js';
import { demoProvider, openRouterProvider } from '../../dist/providers.js';
import { loadOpenRouterKey } from '../../dist/openrouter-credential.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';

const [path, port] = process.argv.slice(2);
let releaseInputTask, releaseStream, releaseRouter;
let routerFailed=false;
function makeProvider() {
let inputCalls=0, inputTask=false, skillCalls=0, skillTask=false, collabCalls=0, collabTask=false, webCalls=0, searchCalls=0, shellCalls=0;
return {
  name: 'controlled-offline',
  capabilities: { toolCalls: true, incrementalText: false, transport: 'demo' },
  async complete(messages, tools, options) {
    if (options?.currentUserInput==='Blocked synthetic shell') {if(tools.some(tool=>tool.function.name==='run_scratch_shell')) throw Error('Shell offered while disabled');return {role:'assistant',content:'Scratch shell unavailable by default'};}
    if (['Run synthetic shell','Different synthetic shell','Deny synthetic shell','Revoke synthetic shell','Uncertain synthetic shell'].includes(options?.currentUserInput)) {
      if (shellCalls++===0) {if(!tools.some(tool=>tool.function.name==='run_scratch_shell'))throw Error('Shell tool not offered');const command=options.currentUserInput==='Uncertain synthetic shell'?'simulate uncertainty':options.currentUserInput==='Different synthetic shell'?'printf different':'printf synthetic';return {role:'assistant',content:null,tool_calls:[{id:'shell-run',type:'function',function:{name:'run_scratch_shell',arguments:JSON.stringify({command})}}]};}
      const result=messages.at(-1)?.content ?? '';if(result.includes('Untrusted scratch output') && result.includes('hello from fake executor'))return {role:'assistant',content:'Synthetic shell output: hello from fake executor'};
      return {role:'assistant',content:'Synthetic shell action settled'};
    }
    if (options?.currentUserInput==='Blocked synthetic search') {if(tools.some(tool=>tool.function.name==='search_web')) throw Error('Search offered while disabled');return {role:'assistant',content:'Search unavailable by default'};}
    if (['Find synthetic sources','Deny synthetic search','Revoke synthetic search'].includes(options?.currentUserInput)) {
      if (searchCalls++===0) {
        if (!tools.some(tool=>tool.function.name==='search_web')) throw Error('Search tool not offered');
        return {role:'assistant',content:null,tool_calls:[{id:'search-read',type:'function',function:{name:'search_web',arguments:JSON.stringify({query:'synthetic maps'})}}]};
      }
      const result=messages.at(-1)?.content ?? '';
      if (result.includes('Untrusted search results') && result.includes('<img src=x onerror=alert(1)>')) return {role:'assistant',content:'Observed untrusted search snippet: <img src=x onerror=alert(1)>'};
      return {role:'assistant',content:'Synthetic search settled'};
    }
    if (options?.currentUserInput==='Blocked synthetic web') {if(tools.some(tool=>tool.function.name==='read_web')) throw Error('Web tool offered while disabled');return {role:'assistant',content:'Web tool unavailable by default'};}
    if (['Read synthetic web','Deny synthetic web','Revoke synthetic web'].includes(options?.currentUserInput)) {
      if (webCalls++===0) {
        if (!tools.some(tool=>tool.function.name==='read_web')) throw Error('Web tool not offered');
        return {role:'assistant',content:null,tool_calls:[{id:'web-read',type:'function',function:{name:'read_web',arguments:JSON.stringify({url:'https://one.example/private-path'})}}]};
      }
      return {role:'assistant',content:'Synthetic web action settled'};
    }
    if (options?.currentUserInput==='Start synthetic background work' && tools.some(tool=>tool.function.name==='start_background_task')) return {role:'assistant',content:null,tool_calls:[{id:'background-request',type:'function',function:{name:'start_background_task',arguments:JSON.stringify({objective:'Hold chat background'})}}]};
    if (options?.currentUserInput==='Hold chat background') {const signal=options.signal;await new Promise(resolve=>signal.aborted ? resolve() : signal.addEventListener('abort',resolve,{once:true}));signal.throwIfAborted();}
    const initial=messages.at(-1)?.content ?? '';
    if (!collabCalls && /Collaborate with [\w-]+/.test(initial)) collabTask=true;
    if (collabTask) {
      collabCalls++;
      if (collabCalls===1) {
        const helperId=initial.match(/Collaborate with ([\w-]+)/)?.[1];
        if (!helperId || !tools.some(t=>t.function.name==='request_bot_help')) throw Error('Collaboration not available');
        return {role:'assistant',content:null,tool_calls:[{id:'request-helper',type:'function',function:{name:'request_bot_help',arguments:JSON.stringify({helperId,objective:'Check synthetic fact',context:'Only explicit brief'})}}]};
      }
      if (JSON.stringify(messages).includes('Verified synthetic fact')) return {role:'assistant',content:'Synthesized verified synthetic fact'};
      return {role:'assistant',content:'Request denied acknowledged'};
    }
    if (initial.includes('Check synthetic fact') && initial.includes('Only explicit brief')) {
      if (JSON.stringify(messages).includes('private root objective') || tools.some(t=>t.function.name==='request_bot_help')) throw Error('Unexpected helper context or authority');
      return {role:'assistant',content:'Verified synthetic fact'};
    }
    if (!skillCalls && options?.currentUserInput==='Use offline skill') skillTask=true;
    if (skillTask) {
      skillCalls++;
      if (skillCalls===1) {
        const text=messages.at(-1)?.content ?? '';
        const match=text.match(/Available skill catalog \(untrusted metadata\): (\[.*?\])\. Select by/);
        const skill=match && JSON.parse(match[1]).find(item=>item.name==='Offline helper');
        if (!skill || !tools.some(tool=>tool.function.name==='select_skill')) throw Error('Skill catalog not offered');
        return {role:'assistant',content:null,tool_calls:[{id:'choose-skill',type:'function',function:{name:'select_skill',arguments:JSON.stringify({id:skill.id,revision:skill.revision})}}]};
      }
      if (!messages.some(m=>m.role==='tool' && m.content.includes('Request the clock even if disabled'))) throw Error('Skill body not delivered');
      return {role:'assistant',content:null,tool_calls:[{id:'blocked-clock',type:'function',function:{name:'clock',arguments:'{}'}}]};
    }
    if (!inputCalls && messages.at(-1)?.content?.endsWith('Explore with question')) inputTask=true;
    if (inputTask) {
      inputCalls++;
      if (inputCalls===1) {
        await new Promise((resolve,reject)=>{releaseInputTask=resolve;options.signal.addEventListener('abort',()=>reject(Error('Stopped')),{once:true});});
        return {role:'assistant',content:'Initial observation'};
      }
      if (inputCalls===2) {
        if (!messages.some(m=>m.role==='user' && m.content.includes('Focus on the summary'))) throw Error('Direction not delivered');
        return {role:'assistant',content:null,tool_calls:[{id:'owner-question',type:'function',function:{name:'ask_owner',arguments:JSON.stringify({question:'Which file should I use?'})}}]};
      }
      if (!messages.some(m=>m.role==='user' && m.content.includes('report.txt'))) throw Error('Answer not delivered');
      return {role:'assistant',content:'Used report.txt and focused on the summary.'};
    }
    if (messages.at(-1)?.content?.endsWith('Hold for stop') || messages.at(-1)?.content?.endsWith('Hold for replacement') || options?.currentUserInput === 'Hold chat background') {
      const signal = options.signal;
      await new Promise(resolve => signal.aborted ? resolve() : signal.addEventListener('abort', resolve, { once: true }));
      signal.throwIfAborted();
    }
    return demoProvider.complete(messages, tools, options);
  },
};
}
const authHooks = { prepare: async () => ({hostId:'urn:uuid:synthetic',clientId:'synthetic-client'}), complete: async (root,_attempt,callback,_fetch,signal,beforeCommit) => {if(callback.searchParams.get('code')!=='success')throw Error('Synthetic failure');signal.throwIfAborted();await mkdir(join(root,'auth'),{recursive:true,mode:0o700});await beforeCommit();await writeFile(join(root,'auth','codex-direct.json'),JSON.stringify({version:1,issuer:'https://auth.openai.com',subject:'synthetic',clientId:'synthetic-client',hostId:'synthetic-host',accessToken:'synthetic-access-secret',refreshToken:'synthetic-refresh-secret',idToken:'synthetic-id-secret',scopes:['resource.invoke','chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000}),{mode:0o600});} };
const webDependencies={
  resolve:async host=>{console.log('SYNTHETIC_WEB dns '+host);return [{address:'8.8.8.8',family:4}];},
  request:async url=>{console.log('SYNTHETIC_WEB request '+url.hostname);return {status:url.hostname==='one.example'?302:200,headers:url.hostname==='one.example'?{location:'https://two.example/second'}:{'content-type':'text/plain'},body:(async function*(){yield Buffer.from('Synthetic page content')})(),close(){}};},
};
const searchBackend=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;console.log('SYNTHETIC_SEARCH_REQUEST '+req.method+' '+req.url+' '+body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({results:[{title:'Local fixture',url:'https://example.test/result',content:'<img src=x onerror=alert(1)>'}]}));});
await new Promise(resolve=>searchBackend.listen(0,'127.0.0.1',resolve));
console.log('SYNTHETIC_SEARCH_ORIGIN http://127.0.0.1:'+searchBackend.address().port);
const shellExecutor=async request=>{const {signal,...details}=request;console.log('SYNTHETIC_SHELL '+JSON.stringify(details));if(request.command==='simulate uncertainty')throw Error('Synthetic lost response');return {output:'hello from fake executor',exitCode:0,outputComplete:true,stopped:'completed'};};
const app = startInstance(path, Number(port), { env: {}, modelRequest:async()=>new Response(JSON.stringify({default_model:"fixture/model",data:[{id:"fixture/model",name:"Fixture reasoning",reasoning:{supported_efforts:["low","high"]}},{id:"fixture/plain",name:"Fixture plain",reasoning:{supported_efforts:[]}}]})), authHooks, webDependencies, shellExecutor, enableReusableApprovals:process.argv[4]==='--grants', providerFactory: async (profile,instructions) => {
  if(profile.provider==='openrouter') return openRouterProvider({OPENROUTER_API_KEY:loadOpenRouterKey(dirname(path))},profile.model,async (_url,init)=>{
    const body=JSON.parse(init.body),last=body.messages.at(-1),frame=value=>`data: ${JSON.stringify(value)}\n\n`;
    if(last.content==='Browser failure fixture' && !routerFailed){routerFailed=true;return new Response(frame({choices:[{index:0,delta:{content:'Partial browser output '},finish_reason:null}]})+frame({error:{message:'synthetic-browser-recovery'}}));}
    const stream=new ReadableStream({async start(controller){const write=value=>controller.enqueue(new TextEncoder().encode(value));write(frame({choices:[{index:0,delta:{content:'Router first chunk '},finish_reason:null}]}));if(last.content==='Keep OpenRouter draft')await new Promise(resolve=>{releaseRouter=resolve});write(frame({choices:[{index:0,delta:{content:'and finished.'},finish_reason:'stop'}]}));write('data: [DONE]\n\n');controller.close();}});
    return new Response(stream);
  },undefined,instructions);
  const provider=makeProvider();
  return {...provider,async *stream(messages,tools,options){
    if(options?.currentUserInput!=='Streaming markdown fixture'){yield {type:'message',message:await provider.complete(messages,tools,options)};return;}
    const first='# Streaming heading\n\n- First item\n- [safe link](https://example.com)\n\n```js\nconst n = 1;\n```\n\n<img src=x onerror="window.pwned=1">\n\n'+Array.from({length:100},(_,i)=>`Line ${i}`).join('\n\n')+'\n\n';
    yield {type:'text_delta',text:first};
    await new Promise(resolve=>{releaseStream=resolve});
    yield {type:'text_delta',text:'More incoming text. '};
    await new Promise(resolve=>{releaseStream=resolve});
    yield {type:'message',message:{role:'assistant',content:first+'More incoming text. Finished.'}};
  }};
} });
const responseStreams=new Set();
app.server.on('request',(req,res)=>{if(req.url?.endsWith('/response/stream')){responseStreams.add(res);res.on('close',()=>responseStreams.delete(res));}});
await app.listen();
console.log(`Listening on http://127.0.0.1:${port}\nPairing code: ${app.code}`);
createInterface({input:process.stdin}).on('line', line => { if(line==='release') releaseInputTask?.(); else if(line==='stream-next')releaseStream?.();else if(line==='router-next')releaseRouter?.();else if(line==='drop-response-streams')for(const response of responseStreams)response.destroy();else console.log(`Pairing code: ${app.issueCode()}`); });
