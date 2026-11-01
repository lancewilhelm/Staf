import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { startInstance } from './instance-service.js';

export async function instanceCommand(args: string[]) {
  const [action,...rest]=args;
  if (!action || action === 'help' || action === '--help') {console.log('Usage: instance serve [DATABASE_PATH] [PORT]\n       instance COMMAND URL CREDENTIAL_FILE [ARGUMENTS]\nCommands: pair, clients, revoke, bots, create, inspect, edit, archive, restore, read, send, status, response-follow, discover, defaults, defaults-set, tasks, task, task-follow, task-start, task-stop, task-retry, task-replace, task-direct, task-answer, approvals, approve, deny, approval-settings, set-approval-settings, disclosures, disclosure-approve, disclosure-deny, web-permission, web-permission-set, web-approvals, web-approve, web-deny, search-config, search-config-set, search-permission, search-permission-set, search-approvals, search-approve, search-deny, shell-config, shell-config-set, shell-permission, shell-permission-set, shell-approvals, shell-approve, shell-deny, shell-uncertain, shell-review, approval-grants, approval-grant-revoke, approval-grant-edit, openrouter-status, openrouter-set, openrouter-disconnect, codex-auth-start, codex-auth-current, codex-auth-status, codex-auth-cancel, codex-auth-credential, codex-auth-logout, memory-*, skill-*, schedule-*\nSee docs/usage.md for arguments and examples.');return;}
  if (action === 'serve') {
    const path=resolve(rest[0] || '.staf/instance.sqlite'); const port=Number(rest[1] || 3210);
    if (!Number.isInteger(port) || port<1 || port>65535) throw Error('Invalid port');
    await mkdir(dirname(path),{recursive:true,mode:0o700}); const app=startInstance(path,port); await app.listen();
    if (app.migrationBackup) console.log(`Database backup before migration: ${app.migrationBackup}`);
    console.log(`Listening on http://127.0.0.1:${port}\nPairing code: ${app.code}\nPress Enter to issue a new pairing code.`);
    const input=createInterface({input:process.stdin}); input.on('line',()=>console.log(`Pairing code: ${app.issueCode()}`));
    return;
  }
  const [url,credential,...values]=rest;
  if (!url || !credential) throw Error('Use instance COMMAND URL CREDENTIAL_FILE [ARGUMENTS]. Run instance help or see docs/usage.md for commands.');
  const target=new URL(url); if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw Error('URL must be a loopback http origin');
  async function request(path:string, token:string, body?:object) {
    const response=await fetch(new URL(path,target),{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error'});
    const result: unknown=await response.json(); if (!response.ok) throw Error(`Instance request failed (${response.status}): ${JSON.stringify(result)}`); return result;
  }
  if(action==='pair') {
    if (!values[0]) throw Error('Pairing code required');
    const result=await request('/api/pair','',{code:values[0]});
    await mkdir(dirname(resolve(credential)),{recursive:true,mode:0o700}); await writeFile(credential,JSON.stringify(result),{mode:0o600,flag:'wx'}); console.log('Paired.'); return;
  }
  let create: {name:string; instructions:string; operationId:string; provider?:string; model?:string} | undefined;
  if (action === 'create') {
    const option=values.findIndex(value=>value.startsWith('--'));
    const names=option < 0 ? values : values.slice(0,option);
    if (!names.join(' ').trim()) throw Error('Agent name required. Use instance create URL CREDENTIAL_FILE NAME [--instructions TEXT]');
    const options:Record<string,string>={};
    for(let i=option < 0 ? values.length : option;i<values.length;i+=2) {
      const key=values[i],value=values[i+1];
      if (!key || !['--instructions','--operation-id','--provider','--model'].includes(key)) throw Error('Unknown create option. Use --instructions TEXT, --operation-id ID, --provider PROVIDER or --model MODEL');
      if (value === undefined || value.startsWith('--')) throw Error(`${key} requires TEXT`);
      if (key in options) throw Error(`${key} must appear once`);
      options[key]=value;
    }
    const operationId=options['--operation-id'] ?? randomUUID();
    if(!/^[\w-]{1,100}$/.test(operationId))throw Error('Invalid creation operation ID');
    console.error(`Creation operation ID: ${operationId}`);
    create={name:names.join(' '),instructions:options['--instructions'] ?? '',operationId,...(options['--provider'] !== undefined ? {provider:options['--provider']} : {}),...(options['--model'] !== undefined ? {model:options['--model']} : {})};
  }
  const saved: unknown=JSON.parse(await readFile(credential,'utf8'));
  if (!saved || typeof saved !== 'object' || !('token' in saved) || typeof saved.token !== 'string') throw Error('Invalid client credential');
  const token=saved.token; let result:unknown;
  const memoryPath = (scope:string) => {
    if (scope === 'user') return '/api/memories/user';
    if (/^bot:[\w-]+$/.test(scope)) return '/api/memories/bot/' + scope.slice(4);
    throw Error('Memory scope must be user or bot:BOT_ID');
  };
  const grantDecision = () => {
    if(values.length===1)return {};
    if(values.length!==4 || values[3]!=='--acknowledge-stored-action' || !['bot','all-bots'].includes(values[1]??'') || !['task','remembered'].includes(values[2]??''))throw Error('Use ID [bot|all-bots task|remembered --acknowledge-stored-action]');
    return {grant:{scope:values[1],lifetime:values[2],retentionAcknowledged:true}};
  };
  if(action==='openrouter-status' && values.length===0) result=await request('/api/openrouter-connection',token);
  else if(action==='openrouter-disconnect' && values.length===0) result=await request('/api/openrouter-connection/disconnect',token,{});
  else if(action==='openrouter-set' && values.length===0) {
    if(process.stdin.isTTY) throw Error('Provide the OpenRouter key on standard input; see docs/usage.md');
    let input='';for await(const chunk of process.stdin){input+=String(chunk);if(input.length>4098)throw Error('Key input too long');}
    result=await request('/api/openrouter-connection',token,{key:input.replace(/\r?\n$/, '')});
  }
  else if(action==='approval-grants') result=await request('/api/approval-grants',token);
  else if(action==='approval-grant-revoke' && values.length===2 && values[0]) result=await request(`/api/approval-grants/${encodeURIComponent(values[0])}/revoke`,token,{revision:Number(values[1])});
  else if(action==='approval-grant-edit' && values.length===5 && values[0] && values[4]==='--acknowledge-stored-action') {
    const scope=values[2]==='all-bots'?{kind:'all-bots'}:values[2]?.startsWith('bot:')?{kind:'bot',botId:values[2].slice(4)}:null;
    const lifetime=values[3]==='remembered'?{kind:'remembered'}:values[3]?.startsWith('task:')?{kind:'task',taskId:values[3].slice(5)}:null;
    if(!scope || !lifetime)throw Error('Use ID REVISION bot:ID|all-bots task:ID|remembered --acknowledge-stored-action');
    result=await request(`/api/approval-grants/${encodeURIComponent(values[0])}/edit`,token,{revision:Number(values[1]),scope,lifetime,retentionAcknowledged:true});
  }
  else if(action==='shell-config') result=await request('/api/shell-config',token);
  else if(action==='shell-config-set' && values.length===4) result=await request('/api/shell-config',token,{revision:Number(values[0]),dockerBinary:values[1]==='-'?null:values[1],dockerSocket:values[2]==='-'?null:values[2],imageId:values[3]==='-'?null:values[3]});
  else if(action==='shell-permission' && values[0]) result=await request(`/api/shell-permissions/${encodeURIComponent(values[0]).replace('%3A', ':')}`,token);
  else if(action==='shell-permission-set' && values[0] && ['true','false'].includes(values[1] ?? '')) result=await request(`/api/shell-permissions/${encodeURIComponent(values[0]).replace('%3A', ':')}`,token,{enabled:values[1]==='true'});
  else if(action==='shell-approvals') result=await request('/api/shell-approvals',token);
  else if((action==='shell-approve' || action==='shell-deny') && values[0]) result=await request(`/api/shell-approvals/${encodeURIComponent(values[0])}/${action.slice(6)}`,token,action.endsWith('approve')?grantDecision():{});
  else if(action==='shell-uncertain') result=await request('/api/shell-uncertain',token);
  else if(action==='shell-review' && values[0] && values[1]==='--acknowledge-uncertain' && values.length===2) result=await request(`/api/shell-actions/${encodeURIComponent(values[0])}/review`,token,{acknowledgment:'verified-daemon-identity-and-accepted-late-create-risk'});
  else if(action==='search-config') result=await request('/api/search-config',token);
  else if(action==='search-config-set' && values[0] && values[1]) result=await request('/api/search-config',token,{revision:Number(values[0]),origin:values[1]==='-'?null:values[1]});
  else if(action==='search-permission' && values[0]) result=await request(`/api/search-permissions/${encodeURIComponent(values[0]).replace('%3A', ':')}`,token);
  else if(action==='search-permission-set' && values[0] && ['true','false'].includes(values[1] ?? '')) result=await request(`/api/search-permissions/${encodeURIComponent(values[0]).replace('%3A', ':')}`,token,{enabled:values[1]==='true'});
  else if(action==='search-approvals') result=await request('/api/search-approvals',token);
  else if((action==='search-approve' || action==='search-deny') && values[0]) result=await request(`/api/search-approvals/${encodeURIComponent(values[0])}/${action.slice(7)}`,token,action.endsWith('approve')?grantDecision():{});
  else if(action==='web-permission' && values[0]) result=await request(`/api/web-permissions/${encodeURIComponent(values[0]).replace('%3A', ':')}`,token);
  else if(action==='web-permission-set' && values[0] && ['true','false'].includes(values[1] ?? '')) result=await request(`/api/web-permissions/${encodeURIComponent(values[0]).replace('%3A', ':')}`,token,{enabled:values[1]==='true'});
  else if(action==='web-approvals') result=await request('/api/web-approvals',token);
  else if((action==='web-approve' || action==='web-deny') && values[0]) result=await request(`/api/web-approvals/${encodeURIComponent(values[0])}/${action.slice(4)}`,token,action.endsWith('approve')?grantDecision():{});
  else if(action==='defaults') result=await request('/api/creation-defaults',token);
  else if(action==='defaults-set' && values.length===4) result=await request('/api/creation-defaults',token,{revision:Number(values[0]),provider:values[1],model:values[2]==='-'?null:values[2],reasoning:values[3]==='-'?null:values[3]});
  else if(action==='codex-auth-start') result=await request('/api/codex-auth/start',token,{});
  else if(action==='codex-auth-current') result=await request('/api/codex-auth/current',token);
  else if(action==='codex-auth-credential') result=await request('/api/codex-auth/credential',token);
  else if(action==='codex-auth-logout' && values.length===0) result=await request('/api/codex-auth/logout',token,{});
  else if(action==='codex-auth-status' && values[0]) result=await request(`/api/codex-auth/${encodeURIComponent(values[0])}`,token);
  else if(action==='codex-auth-cancel' && values[0]) result=await request(`/api/codex-auth/${encodeURIComponent(values[0])}/cancel`,token,{});
  else if(action==='schedule-list') result=await request('/api/schedules',token);
  else if(action==='schedule-inspect' && values[0]) result=await request(`/api/schedules/${encodeURIComponent(values[0])}`,token);
  else if(action==='schedule-create' && values[0]) { const schedule:unknown=JSON.parse(await readFile(values[0],'utf8')); if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) throw Error('Schedule file must contain a JSON object'); result=await request('/api/schedules',token,schedule); }
  else if(action==='schedule-resolve' && values[0] && values[1]) result=await request(`/api/schedules/${encodeURIComponent(values[0])}/resolve`,token,{dueAt:Number(values[1])});
  else if(['schedule-enable','schedule-disable','schedule-revoke'].includes(action ?? '') && values[0] && values[1]) result=await request(`/api/schedules/${encodeURIComponent(values[0])}/${action!.slice(9)}`,token,{version:Number(values[1])});
  else   if(action==='skill-list') result=await request('/api/skills',token);
  else if(action==='skill-inspect' && values[0]) result=await request(`/api/skills/${encodeURIComponent(values[0])}`,token);
  else if(action==='skill-bot-list' && values[0]) result=await request(`/api/bots/${encodeURIComponent(values[0])}/skills`,token);
  else if(action==='skill-import' && values.length === 4) result=await request('/api/skills',token,{name:values[0],description:values[1],provenance:values[2],body:values[3]});
  else if(action==='skill-update' && values.length === 6) result=await request(`/api/skills/${encodeURIComponent(values[0]!)}/update`,token,{revision:Number(values[1]),name:values[2],description:values[3],provenance:values[4],body:values[5]});
  else if(action==='skill-enabled' && values[0] && ['true','false'].includes(values[1] ?? '')) result=await request(`/api/skills/${encodeURIComponent(values[0])}/enabled`,token,{enabled:values[1] === 'true'});
  else if(action==='skill-availability' && values[0] && values[1] && ['true','false'].includes(values[2] ?? '')) result=await request(`/api/skills/${encodeURIComponent(values[0])}/availability`,token,{botId:values[1],available:values[2] === 'true'});
  else   if(action==='memory-list' && values[0]) result=await request(memoryPath(values[0]),token);
  else if(action==='memory-add' && values[0] && values[1]) result=await request(memoryPath(values[0]),token,{text:values.slice(1).join(' ')});
  else if(action==='memory-edit' && values[0] && values[1] && values[2] && values[3]) result=await request(memoryPath(values[0])+'/'+encodeURIComponent(values[1])+'/edit',token,{version:Number(values[2]),text:values.slice(3).join(' ')});
  else if(action==='memory-delete' && values[0] && values[1] && values[2]) result=await request(memoryPath(values[0])+'/'+encodeURIComponent(values[1])+'/delete',token,{version:Number(values[2])});
  else if(action==='disclosures') result=await request('/api/disclosures',token);
  else if((action==='disclosure-approve' || action==='disclosure-deny') && values[0]) result=await request(`/api/disclosures/${encodeURIComponent(values[0])}/${action.slice(11)}`,token,{});
  else if(action==='approvals') result=await request('/api/approvals',token);
  else if((action==='approve' || action==='deny') && values[0]) result=await request(`/api/approvals/${encodeURIComponent(values[0])}/${action}`,token,{});
  else if(action==='approval-settings' && values[0]) result=await request(`/api/approval-settings/${encodeURIComponent(values[0]).replace('%3A', ':')}`,token);
  else if(action==='set-approval-settings' && values[0] && values[1] && ['true','false'].includes(values[2] ?? '')) result=await request(`/api/approval-settings/${encodeURIComponent(values[0]).replace('%3A', ':')}`,token,{mode:values[1] === 'inherit' ? null : values[1],clockEnabled:values[2] === 'true'});
  else if(action==='clients') result=await request('/api/clients',token);
  else if(action==='revoke' && values[0]) result=await request(`/api/clients/${encodeURIComponent(values[0])}/revoke`,token,{});
  else if(action==='discover' && values[0] && values.length >= 2) result=await request('/api/bot-discovery',token,{requesterId:values[0],query:values.slice(1).join(' ')});
  else if(action==='bots') result=await request('/api/bots',token);
  else if(action==='create' && create) result=await request('/api/bots',token,create);
  else if(action==='inspect' && values[0]) result=await request(`/api/bots/${encodeURIComponent(values[0])}`,token);
  else if(action==='edit' && values[0] && values[1]) { const profile: unknown=JSON.parse(await readFile(values[1],'utf8')); if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw Error('Profile file must contain a JSON object'); result=await request(`/api/bots/${encodeURIComponent(values[0])}/profile`,token,profile); }
  else if((action==='archive' || action==='restore') && values[0] && values[1]) result=await request(`/api/bots/${encodeURIComponent(values[0])}/${action}`,token,{revision:values[1]});
  else if(action==='read' && values[0]) result=await request(`/api/bots/${encodeURIComponent(values[0])}/messages`,token);
  else if(action==='tasks' && values[0]) result=await request(`/api/bots/${encodeURIComponent(values[0])}/tasks`,token);
  else if(action==='task' && values[0]) result=await request(`/api/tasks/${encodeURIComponent(values[0])}`,token);
  else if(action==='task-follow' && values[0]) { let last=''; for (;;) { const current=await request(`/api/tasks/${encodeURIComponent(values[0])}`,token); const serialized=JSON.stringify(current,null,2); if(serialized!==last){console.log(serialized);last=serialized;} if(!current || typeof current !== 'object' || !('state' in current) || !['waiting','queued','running','stopping'].includes(String(current.state))) return; await new Promise(resolve=>setTimeout(resolve,500)); } }
  else if(action==='task-replace' && values[0] && values[1]) {const id=randomUUID();console.log(`Replacement attempt ID: ${id} (check task if the request is uncertain)`);result=await request(`/api/tasks/${encodeURIComponent(values[0])}/replace`,token,{id,objective:values.slice(1).join(' ')});}
  else if(action==='task-direct' && values[0] && values[1]) {const id=randomUUID();console.log(`Input ID: ${id} (check task if the request is uncertain)`);result=await request(`/api/tasks/${encodeURIComponent(values[0])}/input`,token,{id,kind:'direction',text:values.slice(1).join(' ')});}
  else if(action==='task-answer' && values[0] && values[1] && values[2]) {const id=randomUUID();console.log(`Input ID: ${id} (check task if the request is uncertain)`);result=await request(`/api/tasks/${encodeURIComponent(values[0])}/input`,token,{id,kind:'answer',questionId:values[1],text:values.slice(2).join(' ')});}
  else if(action==='task-stop' && values[0]) result=await request(`/api/tasks/${encodeURIComponent(values[0])}/stop`,token,{});
  else if(action==='task-start' && values[0] && values[1]) { const delegateClock=values[1] === '--delegate-clock'; const objective=values.slice(delegateClock ? 2 : 1).join(' '); if (!objective.trim()) throw Error('Task objective required'); const id=randomUUID(); console.log(`Task attempt ID: ${id} (check task if the request is uncertain)`); result=await request('/api/tasks',token,{id,botId:values[0],objective,delegateClock}); }
  else if(action==='task-retry' && values[0]) { const previous: unknown=await request(`/api/tasks/${encodeURIComponent(values[0])}`,token); if (!previous || typeof previous !== 'object' || !('botId' in previous) || typeof previous.botId !== 'string' || !('objective' in previous) || typeof previous.objective !== 'string' || !('limitMs' in previous) || typeof previous.limitMs !== 'number') throw Error('Invalid task'); const id=randomUUID(); console.log(`Task attempt ID: ${id} (check task if the request is uncertain)`); result=await request('/api/tasks',token,{id,botId:previous.botId,objective:previous.objective,limitMs:previous.limitMs,predecessor:values[0],delegateClock:'delegationClock' in previous && previous.delegationClock === 1}); }
  else if(action==='status' && values[0]) result=await request(`/api/commands/${encodeURIComponent(values[0])}`,token);
  else if(action==='response-follow' && values[0]) {let last='';for(;;){const current=await request(`/api/commands/${encodeURIComponent(values[0])}`,token);if(!current || typeof current!=='object' || !('responseProgress' in current) || !current.responseProgress || typeof current.responseProgress!=='object' || !('state' in current.responseProgress))throw Error('Invalid response progress');const progress=current.responseProgress;const serialized=JSON.stringify(progress);if(serialized!==last){console.log(serialized);last=serialized;}if(!['accepted','running'].includes(String(progress.state)))return;await new Promise(resolve=>setTimeout(resolve,500));}}
  else if(action==='send' && values[0] && values[1]) { const id=randomUUID(); console.log(`Command ID: ${id} (check status if the request is uncertain)`); result=await request('/api/commands',token,{id,botId:values[0],content:values.slice(1).join(' ')}); }
  else throw Error('Invalid instance command or missing arguments. Run instance help or see docs/usage.md.');
  console.log(JSON.stringify(result,null,2));
}
