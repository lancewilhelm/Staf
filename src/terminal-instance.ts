import {providerLabel, providerId} from './provider-label.js';
import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, link, unlink, rename, open, stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ChatInput } from './chat-input.js';
import { startInstance } from './instance-service.js';
import { TerminalView, cleanText } from './terminal-view.js';
import { canUseSettingsMenu, openSettingsMenu } from './settings-menu.js';
import { isRecord } from './validation.js';

const pause = (ms:number) => new Promise(resolve => setTimeout(resolve,ms));
const paths = (root:string) => ({ db:join(root,'instance.sqlite'), credential:join(root,'terminal-credential.json'), descriptor:join(root,'terminal-service.json'), log:join(root,'terminal-service.log') });
const controlPort = (root:string) => 20000 + createHash('sha256').update(root).digest().readUInt32BE(0) % 35000;
const proof = (token:string, port:number, challenge:string) => createHmac('sha256',token).update(`${port}:${challenge}`).digest('hex');
async function exists(path:string) { try { await stat(path); return true; } catch (error) { if (isRecord(error) && error.code === 'ENOENT') return false; throw error; } }
async function credential(root:string) {
  const p=paths(root); await mkdir(root,{recursive:true,mode:0o700});
  if (!await exists(p.credential)) {
    if (await exists(p.db)) throw Error('Local credential is missing for an existing database. Pair an explicit client instead of creating a new local credential.');
    const temporary=join(root,`.terminal-credential-${randomUUID()}`);
    await writeFile(temporary,JSON.stringify({token:randomBytes(32).toString('base64url')}),{flag:'wx',mode:0o600});
    try { await link(temporary,p.credential); } catch(error) { if (!isRecord(error) || error.code !== 'EEXIST') throw error; } finally { await unlink(temporary); }
  }
  const value:unknown=JSON.parse(await readFile(p.credential,'utf8'));
  if (!isRecord(value) || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.token)) throw Error('Invalid local credential');
  return value.token;
}

export async function terminalDaemon(rootArg:string) {
  const root=resolve(rootArg), token=await credential(root), p=paths(root);
  let servicePort=0;
  const coordinator=createServer((req,res)=>{
    const challenge=new URL(req.url ?? '/', 'http://localhost').searchParams.get('challenge');
    if (!challenge || !/^[a-f0-9]{64}$/.test(challenge) || !servicePort) {res.writeHead(503);res.end();return;}
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({port:servicePort,proof:proof(token,servicePort,challenge)}));
  });
  await new Promise<void>((resolve,reject)=>{coordinator.once('error',reject);coordinator.listen(controlPort(root),'127.0.0.1',resolve);});
  try {
    const app=startInstance(p.db,0,{dataDir:root,localBootstrapToken:token});
    servicePort=await app.listen();
    const temporary=join(root,`.terminal-service-${randomUUID()}`);
    await writeFile(temporary,JSON.stringify({pid:process.pid,port:servicePort,controlPort:controlPort(root)}),{mode:0o600,flag:'wx'});await rename(temporary,p.descriptor);
    const stop=()=>{coordinator.close();void app.close().finally(()=>process.exit());};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
  } catch(error) { coordinator.close(); throw error; }
}
async function discover(root:string,token:string) {
  const challenge=randomBytes(32).toString('hex');
  try {
    const response=await fetch(`http://127.0.0.1:${controlPort(root)}/?challenge=${challenge}`,{signal:AbortSignal.timeout(500),redirect:'error'});
    if (response.status===503) return undefined;
    if (!response.ok) throw Error('The local service address is occupied by an unrelated process');
    const result:unknown=await response.json();
    if (!isRecord(result) || typeof result.port!=='number' || !Number.isInteger(result.port) || result.port<1 || result.port>65535 || typeof result.proof!=='string' || !/^[a-f0-9]{64}$/.test(result.proof)) throw Error('The local service address is occupied by an unrelated process');
    const actual=Buffer.from(result.proof,'hex'), expected=Buffer.from(proof(token,result.port,challenge),'hex');
    if (!timingSafeEqual(actual,expected)) throw Error('The local service address is occupied by an unrelated process');
    return `http://127.0.0.1:${result.port}`;
  } catch(error) { if (error instanceof TypeError || (error instanceof DOMException && error.name==='TimeoutError')) return undefined; throw error; }
}
async function localConnection(root:string) {
  const token=await credential(root); let url=await discover(root,token);
  if (!url) {
    const log=await open(paths(root).log,'a',0o600);
    try { const child=spawn(process.execPath,[fileURLToPath(new URL('./cli.js',import.meta.url)),'__terminal-daemon',root],{detached:true,stdio:['ignore',log.fd,log.fd]}); child.unref(); } finally { await log.close(); }
    for(let i=0;i<100 && !url;i++) {await pause(100);url=await discover(root,token);}
  }
  if (!url) throw Error(`Could not start the local instance. Check ${paths(root).log}.`);
  return {url,token};
}
type Connection = {url:string;token:string};
async function request(connection:Connection,path:string,body?:object) {
  const response=await fetch(new URL(path,connection.url),{method:body?'POST':'GET',headers:{Authorization:`Bearer ${connection.token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});
  const result:unknown=await response.json();
  if (!response.ok) throw Error(response.status===401 ? 'Client authorization was revoked. Pair a new client explicitly.' : `Instance request failed (${response.status}): ${JSON.stringify(result)}`);
  return result;
}
function record(value:unknown) {if(!isRecord(value))throw Error('Invalid response from instance');return value;}
function settingIntent(line:string):[string,string]|undefined {
  const command=line.match(/^\/set\s+(provider|model|reasoning)\s+(.+)$/i) ?? line.match(/^(?:please\s+)?(?:set|change)\s+(?:the\s+|my\s+)?(provider|model|reasoning)(?:\s+to)?\s+(.+?)[.!]?$/i);
  return command?.[1] && command[2] ? [command[1].toLowerCase(),command[2].trim()] : undefined;
}
const help = `Commands: /help, /settings, /settings show|models|reasoning,
/set provider|model|reasoning VALUE, /models,
/unset model|reasoning, /confirm-provider, /cancel-provider,
/defaults, /set-default provider|model|reasoning VALUE, /unset-default model|reasoning,
/auth chatgpt login|status|cancel|logout, /usage [details|help], /context [refresh|help],
/stop, /status ID, /edit ID TEXT, /retry ID, /discard ID, /approvals, /approve ID, /deny ID, /quit.
Settings change this bot's shared profile for new work. New bot defaults are separate.
The offline demo echoes input; it is not a model.`;
export async function terminalClient(args:string[]) {
  let root=join(homedir(),'.staf','terminal-instance'), remote:string|undefined, credentialPath:string|undefined;
  let oneShot:string[]|undefined, confirmProviderChange=false;
  if(args[0]==='settings' || args[0]==='auth') {const end=args.findIndex(arg=>arg.startsWith('--'));oneShot=args.slice(0,end<0?args.length:end);args=end<0?[]:args.slice(end);}
  for(let i=0;i<args.length;i++) {const arg=args[i];if(arg==='--confirm-provider-change' && oneShot?.[0]==='settings'){confirmProviderChange=true;continue;}const value=args[++i];if(!value || value.startsWith('--'))throw Error(`Missing value for ${arg}`);if(arg==='--data-dir')root=resolve(value);else if(arg==='--instance')remote=value;else if(arg==='--credential')credentialPath=value;else throw Error(`Unknown argument: ${arg}`);}
  let connection:Connection; const connectionScope=remote ?? 'local';
  if(remote || credentialPath) {
    if(!remote || !credentialPath)throw Error('Use --instance URL with --credential FILE');
    const url=new URL(remote);if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || url.username || url.password || url.pathname!=='/' || url.search || url.hash)throw Error('Instance URL must be a loopback HTTP origin');
    const saved:unknown=JSON.parse(await readFile(credentialPath,'utf8'));if(!isRecord(saved) || typeof saved.token!=='string')throw Error('Invalid client credential');connection={url:url.origin,token:saved.token};
  } else connection=await localConnection(root);
  const bot=record(await request(connection,'/api/main-bot',{}));if(typeof bot.id!=='string')throw Error('Invalid main bot');const botId=bot.id;
  const view=new TerminalView(!!process.stdout.isTTY), errors=new TerminalView(!!process.stderr.isTTY);
  const pendingDir=join(root,'terminal-pending'); await mkdir(pendingDir,{recursive:true,mode:0o700});
  const pendingPath=(id:string)=>join(pendingDir,`${id}.json`);
  let providerChange: {value:string; profile:Record<string,unknown>} | undefined;
  const drafts=new Map<string,string>();
  const unresolved=new Set<string>(), watched=new Set<string>(), shown=new Set<string>(), eventCounts=new Map<string,number>(), provisional=new Map<string,string>(), reconciled=new Set<string>();
  let ownMessage:string|undefined;
  let input:ChatInput|undefined, closed=false, menuActive=false;
  function display(action:()=>void) {if(input)input.display(action);else action();}
  async function loadHistory() {const messages=await request(connection,`/api/bots/${botId}/messages`);if(!Array.isArray(messages))throw Error('Invalid conversation');return messages;}
  function showHistory(messages:unknown[]) {let submitted=ownMessage;ownMessage=undefined;for(const message of messages){if(!isRecord(message) || typeof message.id!=='string' || typeof message.content!=='string' || typeof message.role!=='string' || shown.has(message.id))continue;shown.add(message.id);if(message.role==='user' && message.content===submitted){submitted=undefined;continue;}const label=message.role==='assistant'?'staf':message.role==='assistant_stopped'?'staf (stopped)':message.role;let content=message.content,reconciledResponse=false;if(message.role==='assistant'||message.role==='assistant_stopped'){for(const [id,text] of provisional){if(text && !reconciled.has(id) && content.startsWith(text)){content=content.slice(text.length);reconciledResponse=true;reconciled.add(id);break;}}}console.log(`${view.style(`${label}>`,message.role==='assistant'?'heading':'dim')} ${content||!reconciledResponse?cleanText(content):message.role==='assistant_stopped'?'Response stopped.':'Response completed.'}\n`);}}
  async function history() {const messages=await loadHistory();showHistory(messages);}
  let statusQueue:Promise<void>=Promise.resolve();
  function status(id:string, announce=true, background=false):Promise<unknown> {
    const work=statusQueue.then(async()=>{const value=record(await request(connection,`/api/commands/${encodeURIComponent(id)}`));const messages=await loadHistory();if(background && (closed || menuActive || !watched.has(id)))return value.state;
      const render=()=>{if(Array.isArray(value.runtimeEvents)) {const events=value.runtimeEvents;for(const event of events.slice(eventCounts.get(id) ?? 0)){if(!isRecord(event) || typeof event.name!=='string')continue;if(event.type==='tool_start')console.log(view.style(`[tool_start] ${event.name}`,'status'));else if(event.type==='tool_result')console.log(view.style(`[tool_result] ${event.name} [${event.success?'ok':'failed'}]`,event.success?'success':'error'));}eventCounts.set(id,events.length);}
        if(value.state==='pending' && isRecord(value.responseProgress) && typeof value.responseProgress.text==='string'){const text=value.responseProgress.text,previous=provisional.get(id) ?? '';if(text!==previous){const delta=text.startsWith(previous)?text.slice(previous.length):text;if(delta)console.log(`${view.style('staf (provisional)>','dim')} ${cleanText(delta)}`);provisional.set(id,text);}}
        if(announce || (background && value.state!=='pending'))console.log(view.style(`Command ${id}: ${String(value.state)}${value.error ? ` (${String(value.error)})` : ''}`,'status'));showHistory(messages);};
      if(background)display(render);else render();
      if(['completed','failed','interrupted','stopped'].includes(String(value.state))){if(unresolved.has(id))await unlink(pendingPath(id)).catch(()=>{});unresolved.delete(id);watched.delete(id);provisional.delete(id);reconciled.delete(id);}return value.state;});
    statusQueue=work.then(()=>{},()=>{});return work;
  }
  function watch(id:string) {
    if(watched.has(id))return;watched.add(id);
    let stoppingShown=false;
    const tick=()=>{if(closed || !watched.has(id))return;const timer=setTimeout(async()=>{if(closed || !watched.has(id))return;try{const value=record(await request(connection,`/api/commands/${encodeURIComponent(id)}`));if(!closed && !menuActive){if(isRecord(value.responseProgress) && value.responseProgress.state==='stopping' && !stoppingShown){stoppingShown=true;display(()=>console.log(view.style(`Command ${id}: stopping`,'status')));}await status(id,value.state!=='pending',true);}}catch{}tick();},500);timer.unref();};tick();
  }
  async function profile() {return record(await request(connection,`/api/bots/${botId}`));}
  async function showSettings() {const p=await profile();return [`Provider: ${providerLabel(String(p.provider))}`,`Model: ${String(p.model ?? '(provider default)')}`,`Reasoning: ${String(p.reasoning ?? '(provider default)')}`,`Revision: ${String(p.revision)}`];}
  async function setProfile(key:'provider'|'model'|'reasoning',value:string,confirmed=false, snapshot?:Record<string,unknown>) {const p=snapshot ?? await profile();const normalized=key==='provider'?providerId(value):value; if(key==='provider' && !['demo','codex','openrouter','lmstudio','live'].includes(normalized))throw Error('Unknown provider');if(key==='provider' && normalized!==p.provider && !confirmed)throw Error('Changing provider may send this conversation history to the new provider. Confirm with --confirm-provider-change.');const result=record(await request(connection,`/api/bots/${botId}/selection`,{revision:p.revision,provider:key==='provider'?normalized:p.provider,...(key==='provider'?{}:{[key]:normalized||null})}));return `Saved ${key}: ${key==='provider'?providerLabel(String(result[key])):String(result[key] ?? '(provider default)')}`;}
  async function showDefaults() {const p=record(await request(connection,'/api/creation-defaults'));return [`Provider: ${providerLabel(String(p.provider))}`,`Model: ${String(p.model ?? '(provider default)')}`,`Reasoning: ${String(p.reasoning ?? '(provider default)')}`,`Revision: ${String(p.revision)}`];}
  async function setDefault(key:'provider'|'model'|'reasoning',value:string) {const p=record(await request(connection,'/api/creation-defaults'));const normalized=key==='provider'?providerId(value):value;if(key==='provider' && !['demo','codex','openrouter','lmstudio','live'].includes(normalized))throw Error('Unknown provider');const updated={...p,[key]:normalized || null,...(key==='provider' && normalized!==p.provider?{model:null,reasoning:null}:{})};const result=record(await request(connection,'/api/creation-defaults',updated));return `Saved new bot default ${key}: ${key==='provider'?providerLabel(String(result[key])):String(result[key] ?? '(provider default)')}`;}
  async function models() {const result=record(await request(connection,`/api/bots/${botId}/models`,{}));if(!Array.isArray(result.models))throw Error('Invalid model catalog');return result.models.flatMap(model=>isRecord(model) && typeof model.id==='string'?[model.id]:[]);}
  async function auth(action:string) {
    if(action==='login') {const attempt=record(await request(connection,'/api/codex-auth/start',{}));if(typeof attempt.url!=='string')throw Error('Invalid sign-in response');console.log(view.style(`Open this URL to sign in: ${attempt.url}\nUse /auth chatgpt status to check progress or /auth chatgpt cancel to cancel.`,'status'));return;}
    if(action==='status') {const credential=record(await request(connection,'/api/codex-auth/credential'));const current=record(await request(connection,'/api/codex-auth/current'));const attempt=isRecord(current.attempt)?current.attempt:undefined;console.log(view.style(`ChatGPT: ${credential.signedIn?'saved sign-in; account and model access not verified':'not signed in (no usable saved sign-in)'}${attempt ? ` | Sign-in: ${String(attempt.phase)}` : ''}`,'status'));return;}
    if(action==='cancel') {const current=record(await request(connection,'/api/codex-auth/current'));if(!isRecord(current.attempt) || typeof current.attempt.id!=='string')throw Error('No active sign-in attempt');const result=record(await request(connection,`/api/codex-auth/${encodeURIComponent(current.attempt.id)}/cancel`,{}));console.log(view.style(`Sign-in: ${String(result.phase)}`,'status'));return;}
    if(action==='logout') {await request(connection,'/api/codex-auth/logout',{});console.log(view.style('ChatGPT signed out.','status'));return;}
    throw Error('Use /auth chatgpt login|status|cancel|logout');
  }
  if(oneShot) {
    if(oneShot[0]==='auth') {if(oneShot.length!==3 || !['chatgpt','codex'].includes(oneShot[1] || ''))throw Error('Use staf auth chatgpt login|status|cancel|logout');await auth(oneShot[2] || '');return;}
    const words=oneShot.slice(1);if(!words.length || words[0]==='show') {console.log((await showSettings()).join(' | '));return;}
    if(words.length===1 && words[0]==='defaults') {console.log(`New bot defaults | ${(await showDefaults()).join(' | ')}`);return;}
    const action=words[0];const defaults=action==='set-default' || action==='unset-default', unset=action==='unset' || action==='unset-default';
    if(['set','set-default','unset','unset-default'].includes(action || ''))words.shift();
    const key=words.shift(), value=words.join(' ');if((key!=='provider' && key!=='model' && key!=='reasoning') || (unset ? key==='provider' || !!value : !value))throw Error('Use set provider|model|reasoning VALUE or unset model|reasoning');
    console.log(await (defaults?setDefault(key,value):setProfile(key,value,confirmProviderChange)));return;
  }
  console.log(view.style(`\nStaf | shared main chat ${botId}`,'heading'));console.log(view.style((await showSettings()).slice(0,3).join(' | '),'context'));console.log(view.style('Commands: /settings  /auth  /usage  /context  /help  /quit','dim')+'\n');await history();
  const pending=await readdir(pendingDir);for(const file of pending){if(!/^[a-f0-9-]{36}\.json$/.test(file))continue;const saved:unknown=JSON.parse(await readFile(join(pendingDir,file),'utf8'));if(isRecord(saved) && saved.botId===botId && saved.scope===connectionScope && typeof saved.content==='string'){const id=file.slice(0,-5);if(saved.draft===true){drafts.set(id,saved.content);console.log(view.style(`Unsent draft ${id}: ${cleanText(saved.content)}\nUse /retry ${id} or /discard ${id}.`,'status'));}else{unresolved.add(id);console.log(view.style(`Unresolved command ${id}. Draft: ${saved.content}\nUse /status ${id} before sending another message.`,'status'));}}}
  for(const id of unresolved){try{await status(id);}catch{/* Keep uncertain submissions for explicit recovery. */}}
  input=new ChatInput(view.style('you> ','heading'));input.prompt();for(const id of unresolved)watch(id);
  async function submit(id:string,content:string) {
    await writeFile(pendingPath(id),JSON.stringify({scope:connectionScope,botId,content}),{mode:0o600});drafts.delete(id);unresolved.add(id);await history();
    let claim:Record<string,unknown>;try{claim=record(await request(connection,'/api/commands',{id,botId,content}));}catch(error){console.log(view.style(`Submission uncertain. Use /status ${id} before retrying. ${String(error)}`,'error'));return;}
    if(claim.kind==='busy'){await writeFile(pendingPath(id),JSON.stringify({scope:connectionScope,botId,content,draft:true}),{mode:0o600});unresolved.delete(id);drafts.set(id,content);console.log(view.style(`The bot is busy. Unsent draft ${id}: ${cleanText(content)}\nUse /retry ${id} or /discard ${id}.`,'status'));return;}
    ownMessage=content;let state:unknown;for(let i=0;i<20;i++){await pause(100);state=await status(id,false);if(state!=='pending')break;}if(state==='pending'){console.log(view.style(`Command ID: ${id}\nStill running. Use /status ${id} or /approvals; the message will not be sent again automatically.`,'status'));watch(id);}else if(state!=='completed')await status(id);
  }
  try {for await(const raw of input) {const line=raw.trim();if(!line){input.prompt();continue;}if(['/quit','/exit'].includes(line))break;
    try {
      if(line==='/help')console.log(view.style(help,'dim'));
      else if(line==='/settings' || /^(?:please\s+)?(?:show|what are)\s+(?:my\s+|the\s+)?settings[?.!]?$/i.test(line)) {if(line==='/settings' && canUseSettingsMenu()){menuActive=true;input.suspend();let result;try{result=await openSettingsMenu({show:showSettings,set:(key,value)=>setProfile(key,value,true),models,showDefaults,setDefault},view);}finally{menuActive=false;input.resume();}if(result.exit)break;if(result.signIn)await auth('login');}else console.log(view.style((await showSettings()).join(' | '),'context'));}
      else if(line==='/defaults')console.log(view.style(`New bot defaults | ${(await showDefaults()).join(' | ')}`,'context'));
      else if(line.startsWith('/set-default ')) {const match=line.match(/^\/set-default\s+(provider|model|reasoning)\s+(.+)$/i);if(!match || !match[1] || !match[2])throw Error('Use /set-default provider|model|reasoning VALUE');const key=match[1].toLowerCase();if(key==='provider'||key==='model'||key==='reasoning')console.log(view.style(await setDefault(key,match[2].trim()),'success'));}
      else if(line==='/settings show' || line==='/settings reasoning')console.log(view.style((await showSettings()).join(' | '),'context'));
      else if(line==='/confirm-provider') {if(!providerChange)throw Error('No provider change is awaiting confirmation');const change=providerChange;providerChange=undefined;console.log(view.style(await setProfile('provider',change.value,true,change.profile),'success'));}
      else if(line==='/cancel-provider') {providerChange=undefined;console.log('Provider change canceled.');}
      else if(/^\/unset(?:-default)?\s+(model|reasoning)$/i.test(line)) {const [command,key]=line.toLowerCase().split(/\s+/);if(key==='model'||key==='reasoning')console.log(view.style(await (command==='/unset-default'?setDefault(key,''):setProfile(key,'')),'success'));}
      else if(settingIntent(line)) {const intent=settingIntent(line);if(intent){const [key,value]=intent;if(key==='provider'){const current=await profile();const normalized=providerId(value);if(!['demo','codex','openrouter','lmstudio','live'].includes(normalized))throw Error('Unknown provider');if(normalized===current.provider){providerChange=undefined;console.log(view.style(`Provider unchanged: ${providerLabel(normalized)}`,'status'));}else{providerChange={value:normalized,profile:current};console.log(view.style(`Changing provider from ${providerLabel(String(current.provider))} to ${providerLabel(normalized)} may send this conversation history to ${providerLabel(normalized)} on the next request. Remembered choices or first-use defaults will be used. Use /confirm-provider to apply or /cancel-provider to cancel.`,'status'));}}else if(key==='model'||key==='reasoning')console.log(view.style(await setProfile(key,value),'success'));}}
      else if(line==='/models' || line==='/settings models')console.log(view.style((await models()).join('\n') || 'No models advertised.','status'));
      else if(line.startsWith('/auth')) {const words=line.split(/\s+/);if(words.length!==3 || !['chatgpt','codex'].includes(words[1] || ''))throw Error('Use /auth chatgpt login|status|cancel|logout');await auth(words[2] || '');}
      else if(line.startsWith('/usage')) {const words=line.split(/\s+/),option=words[1];if(words.length>2 || option && !['help','details'].includes(option))throw Error('Use /usage [details|help]');if(option==='help')console.log('Usage counts reported by the provider for this shared bot.');else {const result=record(await request(connection,`/api/bots/${botId}/usage`));console.log(view.style(String(option==='details'?result.details:result.text),'status'));}}
      else if(line.startsWith('/context')) {const words=line.split(/\s+/),option=words[1];if(words.length>2 || option && !['help','refresh'].includes(option))throw Error('Use /context [refresh|help]');if(option==='help')console.log('Context describes the shared conversation. Refresh requests model metadata.');else {if(option==='refresh')await models();const result=record(await request(connection,`/api/bots/${botId}/context`));console.log(view.style(String(result.text),'status'));}}
      else if(line==='/approvals')console.log(cleanText(JSON.stringify(await request(connection,'/api/approvals'),null,2)));
      else if(/^\/(approve|deny)\s+[\w-]+$/.test(line)){const [action,id]=line.split(/\s+/);console.log(cleanText(JSON.stringify(await request(connection,`/api/approvals/${id}/${action?.slice(1)}`,{}))));}
      else if(line==='/stop') {const progress=await request(connection,`/api/bots/${botId}/response`);if(!isRecord(progress) || typeof progress.id!=='string')console.log('No response to stop.');else {const result=record(await request(connection,`/api/commands/${encodeURIComponent(progress.id)}/stop`,{}));console.log(view.style(`Response ${String(result.state)}.`, 'status'));watch(progress.id);}}
      else if(line.startsWith('/status '))await status(line.slice(8).trim());
      else if(line.startsWith('/edit ')) {const match=raw.match(/^\/edit\s+([\w-]+)\s+([\s\S]+)$/);if(!match?.[1] || !match[2]?.trim() || !drafts.has(match[1]))throw Error('Use /edit ID TEXT for a saved unsent draft');const id=match[1],content=match[2];await writeFile(pendingPath(id),JSON.stringify({scope:connectionScope,botId,content,draft:true}),{mode:0o600});drafts.set(id,content);console.log(view.style(`Updated unsent draft ${id}.`,'status'));}
      else if(line.startsWith('/retry ')) {const id=line.slice(7).trim(), content=drafts.get(id);if(content===undefined)throw Error('No saved unsent draft with that ID');if(unresolved.size)throw Error('Resolve pending commands with /status before retrying');await submit(id,content);}
      else if(line.startsWith('/discard ')) {const id=line.slice(9).trim();if(!unresolved.has(id) && !drafts.has(id))throw Error('No local pending draft with that ID');await unlink(pendingPath(id));unresolved.delete(id);drafts.delete(id);console.log(view.style(`Discarded local pending draft ${id}. This does not cancel a command that reached the instance; check its status before retrying to avoid duplicate work.`,'status'));}
      else if(line.startsWith('/'))console.log('Unknown command. Use /help.');
      else if(unresolved.size){const id=randomUUID();await writeFile(pendingPath(id),JSON.stringify({scope:connectionScope,botId,content:raw,draft:true}),{mode:0o600,flag:'wx'});drafts.set(id,raw);console.log(view.style(`Previous submission unresolved. Unsent draft ${id}: ${cleanText(raw)}\nUse /edit ${id} TEXT, /retry ${id} after it settles, or /discard ${id}.`,'status'));}
      else {const id=randomUUID();await writeFile(pendingPath(id),JSON.stringify({scope:connectionScope,botId,content:raw}),{mode:0o600,flag:'wx'});await submit(id,raw);}
    } catch(error) {console.error(errors.style(`Staf: ${error instanceof Error?error.message:String(error)}`,'error'));}
    input.prompt();
  }} finally {closed=true;input.close();}
}
