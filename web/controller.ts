import {agentImageBodyType,agentImageByteLimit,parseAgentImage,parseAgentImageInput,type AgentImage,type AgentImageInput} from '../src/agent-image';
import {parseToolMode,type ToolMode} from '../src/tool-mode';
import type {ToastNotice} from './toast-notice';
import {responseEvents} from './response-stream';
import {z} from 'zod';
import type { Memory, MemoryScope } from '../src/memory-types';

export type ModelCatalog={models:Array<{id:string;label:string;reasoning:string[]|null;reasoningStatus:string}>;defaultModel?:string};
export type Bot={revision?:string;id:string;name:string;provider:string;model:string|null;archived:boolean;image?:AgentImage};
export type BotProfile=Bot & {image:AgentImage;revision:string;instructions:string;description:string;reasoning:string|null;configDir:string;toolMode:ToolMode;providerChoices?:Record<string,{model:string|null;reasoning:string|null}>};
export type Core = {source:'default'|'override';content:string;defaultContent:string;path:string;revision:string};
function parseCore(value:unknown):Core {
  if (!isRecord(value) || (value.source!=='default' && value.source!=='override') || typeof value.content!=='string' || typeof value.defaultContent!=='string' || typeof value.path!=='string' || typeof value.revision!=='string' || !/^[a-f0-9]{64}$/.test(value.revision)) throw Error('Invalid core response');
  return {source:value.source,content:value.content,defaultContent:value.defaultContent,path:value.path,revision:value.revision};
}
export type Message={id:string;role:string;content:string;taskAttemptId?:string};
export function nextChatMessage(messages:Message[],index:number):Message|undefined {
  if(index<0)return undefined;
  do {index++;} while(messages[index]?.role==='task');
  return messages[index];
}
export type TaskActivity={seq:number;type:string;message?:string;text?:string;name?:string;content?:string;success?:boolean;late?:boolean};
export type ConversationTask={id:string;taskId:string;botId:string;objective:string;state:string;outcome:string|null;anchorMessageId:string|null;activity:TaskActivity[]};
const chatEventSchema=z.object({id:z.number().int(),type:z.enum(['tool_start','tool_result','assistant_message']),name:z.string(),success:z.number().nullable(),detail:z.string().nullable(),arguments:z.string().nullable(),callId:z.string().nullable()});
export type ChatEvent=z.infer<typeof chatEventSchema>;
export type ResponseProgress={id:string;botId:string;state:'accepted'|'running'|'stopping'|'stopped'|'completed'|'failed'|'interrupted';text:string;error:string|null;events?:ChatEvent[]};
export type ChatWork={id:string;processes:Array<{id:string;state:string;mode:string;retained:boolean;inputClosed:boolean;cols:number|null;rows:number|null;exitCode:number|null;exitSignal:string|null}>;progress:ResponseProgress;codeExecutions:Array<{id:string;source:string;sourceHash:string;outcome:string;result:unknown;actions:string[]}>;events:ChatEvent[]};
export type InboxItem={kind:'question';id:string;botId:string|null;attemptId:string;text:string}|{kind:'approval';approvalKind:'clock'|'web'|'search'|'shell'|'disclosure';id:string;botId:string|null;work:{kind:'task'|'command';id:string};detail:unknown};
type SubmissionIdentity={id:string;text:string};
export type Submission=SubmissionIdentity & (
  | {kind:'submitting'|'submitting-uncertain'|'pending'}
  | {kind:'unknown'|'uncertain-busy'|'busy'|'rejected';error:string}
  | {kind:'failed'|'interrupted';error:string|null}
);
export type Draft={text:string;submission:Submission|null};
export type Connection={kind:'connecting'}|{kind:'pairing';message:string}|{kind:'ready'}|{kind:'offline';message:string};
export type Setup={kind:'closed'}|{kind:'create';name:string;instructions:string;provider:string;model:string;reasoning?:string;toolMode?:ToolMode;image?:AgentImageInput;operationId:string|null;explicitChoices?:boolean;status:string};
export type Workspace={datasetIdentity:string|null;connection:Connection;setup:Setup;bots:Bot[];selected:string|null;messages:Message[];work:ChatWork[];tasks:ConversationTask[];response:ResponseProgress|null;responseConnection:'connecting'|'connected'|'reconnecting';inbox:InboxItem[];credential:'signed-in'|'signed-out'|'unknown';openrouter:'saved'|'missing'|'unknown'|'error';authAttempt:{id:string;phase:string}|null;authUrl:string;authUrlAttemptId:string;freshness:string;notice:string;notices:ToastNotice[];authStarting:boolean;authStatus:string;actionError:string;draft:Draft;draftReady:boolean;legacyRecords:Array<{key:string;value:string}>};
class ApiError extends Error {constructor(message:string,readonly status:number){super(message);}}
const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
type ProviderDefaults={revision:string;providers:Record<string,{model:string|null;reasoning:string|null}>};
const isNullableString=(value:unknown):value is string|null=>value===null||typeof value==='string';
function isChoices(value:unknown):value is ProviderDefaults['providers'] {return isRecord(value)&&Object.values(value).every(pair=>isRecord(pair)&&isNullableString(pair.model)&&isNullableString(pair.reasoning));}
function parseProviderDefaults(value:unknown):ProviderDefaults {if(!isRecord(value)||typeof value.revision!=='string'||!isChoices(value.providers))throw Error('Invalid provider defaults response. Refresh and retry; your edits are retained.');return {revision:value.revision,providers:value.providers};}
function parseModelCatalog(value:unknown):ModelCatalog {
 if(!isRecord(value)||!Array.isArray(value.models)||(value.defaultModel!==undefined&&typeof value.defaultModel!=='string')||!value.models.every((model:unknown)=>isRecord(model)&&typeof model.id==='string'&&typeof model.label==='string'&&['advertised','unknown','unsupported-transport'].includes(String(model.reasoningStatus))&&(model.reasoning===null||Array.isArray(model.reasoning)&&model.reasoning.every((effort:unknown)=>typeof effort==='string'))&&(model.reasoningStatus!=='advertised'||Array.isArray(model.reasoning))))throw Error('Invalid model catalog. Enter a model ID manually or retry discovery.');
 return {models:value.models,...(typeof value.defaultModel==='string'?{defaultModel:value.defaultModel}:{})};
}
function parseSelection(value:unknown):BotProfile {
 if(!isRecord(value)||typeof value.id!=='string'||typeof value.name!=='string'||typeof value.provider!=='string'||!isNullableString(value.model)||typeof value.archived!=='boolean'||typeof value.revision!=='string'||typeof value.instructions!=='string'||typeof value.description!=='string'||!isNullableString(value.reasoning)||typeof value.configDir!=='string'||(value.providerChoices!==undefined&&!isChoices(value.providerChoices)))throw Error('Invalid selection response. Compare the current settings before retrying.');
 return {image:parseAgentImage(value.image),id:value.id,name:value.name,provider:value.provider,model:value.model,archived:value.archived,revision:value.revision,instructions:value.instructions,description:value.description,reasoning:value.reasoning,configDir:value.configDir,toolMode:parseToolMode(value.toolMode),...(value.providerChoices===undefined?{}:{providerChoices:value.providerChoices})};
}

function parseMemories(value: unknown, scope: MemoryScope): Memory[] {
  if (!Array.isArray(value)) throw Error('Invalid memory response.');
  const ids = new Set<string>();
  return value.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 4000 || typeof entry.version !== 'number' || !Number.isSafeInteger(entry.version) || entry.version < 1 || typeof entry.createdAt !== 'string' || !Number.isFinite(Date.parse(entry.createdAt)) || typeof entry.updatedAt !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt)) || !isRecord(entry.scope) || entry.scope.kind !== scope.kind || (scope.kind === 'bot' && entry.scope.botId !== scope.botId)) throw Error('Invalid memory response or audience.');
    ids.add(entry.id);
    return { id: entry.id, text: entry.text, version: entry.version, createdAt: entry.createdAt, updatedAt: entry.updatedAt, scope };
  });
}

function isResponseProgress(value:unknown,botId:string):value is ResponseProgress {
  return isRecord(value)&&typeof value.id==='string'&&value.botId===botId&&typeof value.state==='string'&&['accepted','running','stopping','stopped','completed','failed','interrupted'].includes(value.state)&&typeof value.text==='string'&&(value.error===null||typeof value.error==='string')&&(value.events===undefined||z.array(chatEventSchema).safeParse(value.events).success);
}
const prefix='staf-workspace-v1:';
function normalizeDraft(draft:Draft):Draft {
  const submission=draft.submission;
  if(submission?.kind==='submitting'||submission?.kind==='submitting-uncertain')return {...draft,submission:{id:submission.id,text:submission.text,kind:'unknown',error:'Recovering the original request.'}};
  if(submission && submission.kind==='busy' && 'uncertain' in submission && submission.uncertain===true)return {...draft,submission:{id:submission.id,text:submission.text,kind:'uncertain-busy',error:'Another response is in progress. The original request may still arrive.'}};
  return draft;
}
export class Controller {
  private setupGeneration=0; private setupModelGeneration=0; private setupReasoningGeneration=0; private dataset:string|null=null; private datasetEpoch=0; private writer=crypto.randomUUID(); private checking=false; private listeners=new Set<()=>void>(); private generation=0; private token=localStorage.getItem('staf-token')||''; private currentKey=''; private timer:number; private responseStream:{botId:string;controller:AbortController}|null=null;
  state:Workspace={datasetIdentity:null,connection:{kind:'connecting'},setup:{kind:'closed'},bots:[],selected:null,messages:[],work:[],tasks:[],response:null,responseConnection:'connecting',inbox:[],credential:'unknown',openrouter:'unknown',authAttempt:null,authUrl:'',authUrlAttemptId:'',freshness:'',notice:'',notices:[],authStarting:false,authStatus:'',actionError:'',draft:{text:'',submission:null},draftReady:false,legacyRecords:[]};
  constructor(){this.timer=window.setInterval(()=>{if(document.visibilityState==='visible')void this.refresh()},1000);window.addEventListener('online',()=>void this.refresh());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void this.refresh()});void this.removeObsoleteRecords();void this.refresh()}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn)};
  snapshot=()=>this.state;
  datasetGeneration=()=>this.datasetEpoch;
  notify(message:string,kind:ToastNotice['kind']='info',topic?:string){this.update({notices:[...this.state.notices.filter(n=>!topic||n.topic!==topic),{id:crypto.randomUUID(),message,kind,...(topic?{topic}:{})}]})}
  dismissNotice=(id:string)=>{this.update({notices:this.state.notices.filter(n=>n.id!==id)})};
  private update(change:Partial<Workspace>){
    if(change.notice){change.notices=[...this.state.notices,{id:crypto.randomUUID(),message:change.notice,kind:'info'}]}
    this.state={...this.state,...change};this.listeners.forEach(fn=>fn())}
  private async syncDataset(gen:number) {
    const response=await fetch('/api/dataset',{cache:'no-store'});const data:unknown=await response.json();
    if(!response.ok||!isRecord(data)||typeof data.id!=='string'||!/^[a-f0-9]{64}$/.test(data.id))throw Error('Dataset identity unavailable');
    if(gen!==this.generation)return false;
    if(this.dataset!==data.id){
      const changed=this.dataset!==null;this.dataset=data.id;this.datasetEpoch++;this.setupGeneration++;this.draftLoad++;this.currentKey='';this.retainedCreation=null;this.watchResponse(null);
      this.update({datasetIdentity:data.id,legacyRecords:[]});
      if(changed)this.update({setup:{kind:'closed'},bots:[],selected:null,messages:[],work:[],tasks:[],response:null,draft:{text:'',submission:null},draftReady:false,notice:'The development dataset changed. Previous browser drafts and pending creations remain saved separately.'});
      void this.restoreCreation(data.id);
    }
    return true;
  }
  private async api<T>(path:string,body?:unknown,signal?:AbortSignal,contentType='application/json'):Promise<T>{const dataset=this.dataset;if(!dataset)throw Error('Dataset identity unavailable');const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'X-Staf-Dataset':dataset,...(body===undefined?{}:{'Content-Type':contentType}),...(this.token?{Authorization:'Bearer '+this.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});const data:unknown=await response.json();const responseDataset=response.headers.get('X-Staf-Dataset');if(this.dataset!==dataset||(responseDataset!==null&&responseDataset!==dataset)||(response.ok&&responseDataset===null))throw Error('Dataset changed. Refresh before retrying.');if(!response.ok){const message=typeof data==='object'&&data!==null&&'error'in data&&typeof data.error==='string'?data.error:'Request failed';throw new ApiError(message,response.status)}return data as T}
  private watchResponse(botId:string|null){
    if(this.responseStream?.botId===botId && !this.responseStream.controller.signal.aborted)return;
    this.responseStream?.controller.abort();this.responseStream=null;
    if(!botId || !this.token)return;
    const controller=new AbortController(),token=this.token;this.responseStream={botId,controller};this.update({responseConnection:'connecting'});
    void (async()=>{while(!controller.signal.aborted && this.token===token){
      try {
        const response=await fetch('/api/bots/'+botId+'/response/stream',{headers:{Authorization:'Bearer '+token,Accept:'text/event-stream'},signal:controller.signal});
        if(response.status===401){if(this.token===token){this.token='';this.watchResponse(null);localStorage.removeItem('staf-token');this.update({connection:{kind:'pairing',message:'Pairing expired or was revoked.'}})}return;}
        if(!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream'))throw Error('Response stream unavailable');
        this.update({responseConnection:'connected'});
        for await(const event of responseEvents(response.body)){
          if(controller.signal.aborted || this.state.selected!==botId)break;
          if(!isRecord(event))throw Error('Invalid response stream event');
          const previous=this.state.response;
          let next:ResponseProgress|null;
          if(event.type==='snapshot' && (event.response===null || isResponseProgress(event.response,botId)))next=event.response?.state==='completed' && previous?.id===event.response.id ? {...event.response,text:previous.text} : event.response;
          else if(event.type==='delta' && typeof event.id==='string' && typeof event.text==='string' && previous?.id===event.id && previous.state==='running')next={...previous,text:previous.text+event.text};
          else throw Error('Invalid response stream event');
          this.update({response:next});
          if(previous?.id!==next?.id || (previous?.state!==next?.state && next && !['accepted','running'].includes(next.state)))void this.refresh();
        }
      }catch{if(controller.signal.aborted)return;}
      if(!controller.signal.aborted){this.update({responseConnection:'reconnecting'});await new Promise(resolve=>setTimeout(resolve,1000));}
    }})();
  }
  async pair(code:string){try{const gen=++this.generation;if(!await this.syncDataset(gen))return;const result=await this.api<{token:string}>('/api/pair',{code});localStorage.setItem('staf-token',result.token);this.token=result.token;await this.refresh()}catch(e){this.update({connection:{kind:'pairing',message:String(e)}})}}
  async refresh(){const gen=++this.generation;try{if(!await this.syncDataset(gen))return;if(!this.token){this.update({connection:{kind:'pairing',message:''}});return}const [bots,allInbox,credential,current,openrouter]=await Promise.all([this.api<Bot[]>('/api/bots').then(bots=>bots.map(bot=>({...bot,image:parseAgentImage(bot.image)}))),this.api<InboxItem[]>('/api/inbox'),this.api<{signedIn:boolean}>('/api/codex-auth/credential'),this.api<{attempt:{id:string;phase:string}|null}>('/api/codex-auth/current'),this.api<{saved:boolean}>('/api/openrouter-connection').catch(()=>({saved:null}))]);const inbox=allInbox;const preferred=this.state.selected||sessionStorage.getItem('staf-selected-agent');const selected=preferred && bots.some(b=>b.id===preferred&&!b.archived)?preferred:bots.find(b=>!b.archived)?.id??null;const chat=selected?await this.api<{messages:Message[];requests:ChatWork[];tasks:ConversationTask[]}>('/api/bots/'+selected+'/chat-work'):{messages:[],requests:[],tasks:[]};const {messages,requests:work,tasks}=chat;if(gen!==this.generation)return;const changed=selected!==this.state.selected;if(changed){await this.loadDraft(selected,gen);if(gen!==this.generation)return;}this.reconcileAuth(current.attempt);this.update({connection:{kind:'ready'},bots,selected,messages,...(changed?{response:null}:{}),work,tasks,inbox,credential:credential.signedIn?'signed-in':'signed-out',openrouter:openrouter.saved===null?'error':openrouter.saved?'saved':'missing',authAttempt:current.attempt,freshness:''});this.watchResponse(selected);void this.recoverLegacy();if(!this.state.draft.text&&!this.state.draft.submission)void this.recoverNext();if(this.state.draft.submission && (['pending','unknown'].includes(this.state.draft.submission.kind)||this.state.draft.submission.kind==='uncertain-busy'))void this.checkSubmission()}catch(e){if(gen!==this.generation)return;if(e instanceof ApiError&&e.status===401){this.token='';this.watchResponse(null);localStorage.removeItem('staf-token');this.update({connection:{kind:'pairing',message:'Pairing expired or was revoked.'}})}else this.update({connection:{kind:'offline',message:'Connection unavailable. Showing the last successful update.'},freshness:String(e)})}}
  async select(id:string){
    if(id===this.state.selected)return;
    sessionStorage.setItem('staf-selected-agent',id);this.generation++;
    this.currentKey='';this.update({selected:id,messages:[],work:[],tasks:[],response:null,draft:{text:'',submission:null},draftReady:false});
    this.watchResponse(id);await this.loadDraft(id);if(this.state.selected===id)void this.refresh();
  }
  private claims=new Set<string>(); private draftLoad=0; private recovering=false;
  private async claim(key:string):Promise<boolean>{
    if(this.claims.has(key))return true;
    if(!navigator.locks)throw Error('Browser storage locking is unavailable');
    return new Promise((resolve,reject)=>{
      void navigator.locks.request('staf-draft:'+key,{ifAvailable:true},async lock=>{
        if(!lock){resolve(false);return;}
        this.claims.add(key);resolve(true);
        await new Promise<void>(()=>{});
      }).catch(reject);
    });
  }
  private async loadDraft(id:string|null, expectedGeneration?:number){
    const load=++this.draftLoad;this.currentKey='';this.update({draftReady:false});let draft:Draft={text:'',submission:null};
    try{
      if(id){
        const own=prefix+this.dataset+':'+this.writer+':'+id;
        const candidates=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>!!key && key.startsWith(prefix+this.dataset+':') && key.endsWith(':'+id) && !key.includes(':creation:'));
        const ordered=[...candidates.filter(key=>this.claims.has(key)),...candidates.filter(key=>!this.claims.has(key))];
        let key=own;
        for(const candidate of ordered){
          const saved=localStorage.getItem(candidate);if(!saved)continue;
          const parsed:unknown=JSON.parse(saved);
          if(!isRecord(parsed)||typeof parsed.text!=='string'||(!parsed.text && !parsed.submission))continue;
          if(await this.claim(candidate)){key=candidate;break;}
        }
        if(key===own)await this.recoverLegacyDraft(id,own,()=>load===this.draftLoad&&(expectedGeneration===undefined||expectedGeneration===this.generation));
        if(!await this.claim(key))throw Error('Draft is in use');
        if(load!==this.draftLoad || (expectedGeneration!==undefined && expectedGeneration!==this.generation))return;
        this.currentKey=key;
        const saved=localStorage.getItem(key);
        if(saved)draft=normalizeDraft(JSON.parse(saved));
      }
    }catch{if(load===this.draftLoad && (expectedGeneration===undefined || expectedGeneration===this.generation)){this.currentKey='';this.update({actionError:'Browser storage or locking is unavailable. Sending is blocked.'});this.notify('Browser storage or locking is unavailable. Sending is blocked.','error')}}
    if(load===this.draftLoad && (expectedGeneration===undefined || expectedGeneration===this.generation))this.update({draft,draftReady:!!this.currentKey});
  }
  private async recoverLegacyDraft(id:string, target:string, valid:()=>boolean):Promise<Draft|null>{
    const dataset=this.dataset;
    const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>!!key&&key.startsWith(prefix)&&key.slice(prefix.length).split(':').length===2&&key.endsWith(':'+id)&&!key.startsWith(prefix+'creation:'));
    for(const key of keys){
      const raw=localStorage.getItem(key);if(!raw)continue;
      let saved:unknown;try{saved=JSON.parse(raw)}catch{continue}
      if(!isRecord(saved)||typeof saved.text!=='string'||!isRecord(saved.submission)||typeof saved.submission.id!=='string'||typeof saved.submission.text!=='string'||typeof saved.submission.kind!=='string'||!['submitting','submitting-uncertain','pending','unknown','uncertain-busy','busy','rejected','failed','interrupted'].includes(saved.submission.kind))continue;
      try{
        const command=await this.api<{botId:string;content:string}>('/api/commands/'+encodeURIComponent(saved.submission.id));
        if(command.botId!==id||command.content!==saved.submission.text||this.dataset!==dataset||!valid()||localStorage.getItem(key)!==raw)continue;
        if(!await this.claim(key))continue;
        if(!await this.claim(target))continue;
        if(!valid()||this.dataset!==dataset||localStorage.getItem(key)!==raw)continue;
        localStorage.setItem(target,raw);localStorage.removeItem(key);return normalizeDraft(JSON.parse(raw));
      }catch{/* An unverified record stays available for copy-out. */}
    }
    return null;
  }
  private async recoverNext(){
    const id=this.state.selected,current=this.currentKey;
    if(this.recovering||!id||!current||this.state.draft.text||this.state.draft.submission)return;
    this.recovering=true;
    try{
      const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>!!key&&key!==current&&key.startsWith(prefix+this.dataset+':')&&key.endsWith(':'+id)&&!key.includes(':creation:'));
      for(const key of keys){
        const saved=localStorage.getItem(key);if(!saved)continue;
        const candidate:Draft=JSON.parse(saved);if(typeof candidate.text!=='string'||(!candidate.text&&!candidate.submission))continue;
        if(!await this.claim(key))continue;
        if(this.currentKey!==current||this.state.selected!==id||this.state.draft.text||this.state.draft.submission)return;
        const latest=localStorage.getItem(key);if(!latest)continue;
        const draft=normalizeDraft(JSON.parse(latest));if(typeof draft.text!=='string'||(!draft.text&&!draft.submission))continue;
        this.currentKey=key;this.update({draft});void this.refresh();return;
      }
    const draft=await this.recoverLegacyDraft(id,current,()=>this.currentKey===current&&this.state.selected===id&&!this.state.draft.text&&!this.state.draft.submission);
    if(draft){this.update({draft});void this.refresh();}
    }catch{this.update({actionError:'Could not recover another saved draft.'});this.notify('Could not recover another saved draft.','error')}finally{this.recovering=false}
  }
  private save(draft:Draft):boolean{try{if(!this.currentKey)return false;localStorage.setItem(this.currentKey,JSON.stringify(draft));this.update({draft});if(!draft.text&&!draft.submission)void this.recoverNext();return true}catch{this.update({actionError:'Browser storage is unavailable. Sending is blocked; copy your text before leaving.'});this.notify('Browser storage is unavailable. Sending is blocked; copy your text before leaving.','error');return false}}
  edit(text:string){this.save({...this.state.draft,text})}
  private async removeObsoleteRecords(){
    // These pre-journal keys are obsolete. The v1 journal also contains live
    // tabs and closed-tab drafts, so it must never be swept as legacy data.
    try{for(const key of ['staf-draft','staf-pending'])await navigator.locks.request('staf-draft:'+key,{ifAvailable:true},lock=>{if(lock)localStorage.removeItem(key)})}catch{}
  }
  private retainedCreation:Extract<Setup,{kind:'create'}>|null=null;
  private legacyChecking=false;
  private async recoverLegacy(){
    if(this.legacyChecking||!this.dataset||!this.token)return;
    this.legacyChecking=true;const dataset=this.dataset;
    try{
      const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>!!key&&key.startsWith(prefix)&&key.slice(prefix.length).split(':').length===2);
      for(const key of keys.filter(key=>key.startsWith(prefix+'creation:'))){
        const raw=localStorage.getItem(key);if(!raw)continue;
        let saved:unknown;try{saved=JSON.parse(raw)}catch{continue}
        if(!isRecord(saved)||saved.kind!=='create'||typeof saved.operationId!=='string'||key!==prefix+'creation:'+saved.operationId||typeof saved.name!=='string')continue;
        try{
          const bot=await this.api<Bot>('/api/bot-creations/'+encodeURIComponent(saved.operationId));
          if(this.dataset!==dataset||bot.name!==saved.name||localStorage.getItem(key)!==raw)continue;
          if(!await this.claim(key))continue;
          const target=prefix+'creation:'+dataset+':'+saved.operationId;
          if(localStorage.getItem(target)!==null||!await this.claim(target))continue;
          localStorage.setItem(target,raw);localStorage.removeItem(key);
          await this.restoreCreation(dataset);
        }catch{/* Missing or unavailable status cannot establish the dataset. */}
      }
      if(this.dataset===dataset){
        if(this.state.setup.kind==='closed'&&!this.retainedCreation)await this.restoreCreation(dataset);
        const records=keys.flatMap(key=>{const value=localStorage.getItem(key);return value===null?[]:[{key,value}]});
        if(JSON.stringify(records)!==JSON.stringify(this.state.legacyRecords))this.update({legacyRecords:records});
      }
    }finally{this.legacyChecking=false}
  }
  async discardLegacyRecord(record:{key:string;value:string}, dataset:string|null):Promise<boolean>{
    if(!dataset || this.dataset!==dataset || !this.token || this.claims.has(record.key))return false;
    const parts=record.key.startsWith(prefix)?record.key.slice(prefix.length).split(':'):[];
    if(parts.length!==2)return false;
    try{
      return await navigator.locks.request('staf-draft:'+record.key,{ifAvailable:true},lock=>{
        if(!lock || this.dataset!==dataset || this.claims.has(record.key) || localStorage.getItem(record.key)!==record.value)return false;
        localStorage.removeItem(record.key);
        this.update({legacyRecords:this.state.legacyRecords.filter(item=>item.key!==record.key || item.value!==record.value)});
        return true;
      });
    }catch{return false;}
  }
  private async restoreCreation(dataset:string){
    try{
      const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>!!key&&key.startsWith(prefix+'creation:'+dataset+':'));
      for(const key of keys){
        if(!await this.claim(key))continue;
        const value=localStorage.getItem(key);if(!value)continue;
        const saved:unknown=JSON.parse(value);
        if(!isRecord(saved)||saved.kind!=='create'||typeof saved.operationId!=='string'||key!==prefix+'creation:'+dataset+':'+saved.operationId||typeof saved.name!=='string'||typeof saved.instructions!=='string'||typeof saved.provider!=='string'||typeof saved.model!=='string'||(saved.reasoning!==undefined&&(typeof saved.reasoning!=='string'||!['default','none','minimal','low','medium','high','xhigh','max'].includes(saved.reasoning))))continue;
        const setup:Extract<Setup,{kind:'create'}>={kind:'create',operationId:saved.operationId,name:saved.name,instructions:saved.instructions,provider:saved.provider,model:saved.model,image:parseAgentImageInput(saved.image),...(saved.explicitChoices===true?{explicitChoices:true}:{}),...(saved.toolMode===undefined?{}:{toolMode:parseToolMode(saved.toolMode)}),...(saved.reasoning===undefined?{}:{reasoning:saved.reasoning}),status:'Recovered creation. Check status or retry the same operation.'};
        if(this.dataset!==dataset||this.state.setup.kind!=='closed'||this.retainedCreation)return;
        this.retainedCreation=setup;this.update({setup});return;
      }
    }catch{this.update({actionError:'Could not recover the saved agent creation.'});this.notify('Could not recover the saved agent creation.','error')}
  }
  async send(retry=false){
    const botId=this.state.selected,draft=this.state.draft;
    if(!botId||(!retry&&!draft.text.trim()))return;
    if(this.state.response&&['accepted','running','stopping'].includes(this.state.response.state))return;
    let submission=draft.submission;
    if(!retry){if(submission)return;submission={kind:'submitting',id:crypto.randomUUID(),text:draft.text}}
    else if(submission && (submission.kind==='failed'||submission.kind==='interrupted'))submission={kind:'submitting',id:crypto.randomUUID(),text:submission.text};
    if(!submission)return;
    const current=submission,uncertain=current.kind==='unknown'||current.kind==='uncertain-busy'||current.kind==='submitting-uncertain';
    if(!this.save({...draft,text:retry?draft.text:'',submission:{id:current.id,text:current.text,kind:uncertain?'submitting-uncertain':'submitting'}}))return;
    const bot=this.state.bots.find(item=>item.id===botId);
    const setupError=bot?.provider==='codex'&&this.state.credential==='signed-out'?'Connect ChatGPT in Settings to send.':bot?.provider==='openrouter'&&this.state.openrouter!=='saved'?'Connect OpenRouter in Settings to send.':bot?.provider==='demo'?'Choose a creation default in Settings to migrate this agent.':bot&&!bot.model?.trim()?'Choose a model for this agent to send.':null;
    if(setupError){this.save({...this.state.draft,submission:{id:current.id,text:current.text,kind:uncertain?'unknown':'rejected',error:setupError}});return}
    await this.submit(botId,current);
  }
  async stopProcess(id:string){try{await this.api('/api/processes/'+encodeURIComponent(id)+'/stop',{});await this.refresh();}catch{this.notify('Could not stop the process.','error')}}
  async processInput(id:string,data:string){return this.api('/api/processes/'+encodeURIComponent(id)+'/input',{data});}
  async processEof(id:string){return this.api('/api/processes/'+encodeURIComponent(id)+'/eof',{});}
  async resizeProcess(id:string,cols:number,rows:number){return this.api('/api/processes/'+encodeURIComponent(id)+'/resize',{cols,rows});}
  async processOutput(id:string,cursor=0){return this.api<{gap:boolean;hasMore:boolean;nextCursor:number;chunks:Array<{stream:string;data:string;text:string|null}>}>('/api/processes/'+encodeURIComponent(id)+'/output?cursor='+cursor)}
  async stopResponse(){const response=this.state.response;if(!response||!['accepted','running','stopping'].includes(response.state))return;try{await this.api('/api/commands/'+encodeURIComponent(response.id)+'/stop',{});}catch(e){this.update({actionError:'Could not stop the response. Retry Stop while the response is active.'});this.notify('Could not stop the response. Retry Stop.','error')}}
  private async submit(botId:string,submission:Submission){
    const {id,text}=submission,uncertain=submission.kind==='unknown'||submission.kind==='uncertain-busy'||submission.kind==='submitting-uncertain';
    try{
      const result=await this.api<{kind:string}>('/api/commands',{id,botId,content:text});
      if(this.state.selected!==botId||this.state.draft.submission?.id!==id)return;
      if(result.kind==='busy'){this.save({...this.state.draft,submission:uncertain?{id,text,kind:'uncertain-busy',error:'Another response is in progress. The original request may still arrive.'}:{id,text,kind:'busy',error:'Another response is in progress.'}});return}
      this.save({...this.state.draft,submission:{id,text,kind:'pending'}});
      await this.refresh();
    }catch(e){
      if(this.state.selected!==botId||this.state.draft.submission?.id!==id)return;
      const rejected=!uncertain&&e instanceof ApiError&&e.status>=400&&e.status<500&&e.status!==401;
      this.save({...this.state.draft,submission:{id,text,kind:rejected?'rejected':'unknown',error:String(e)}});
    }
  }
  dismissSubmission(){const submission=this.state.draft.submission;if(submission&&['busy','rejected','failed','interrupted'].includes(submission.kind))this.save({...this.state.draft,submission:null})}
  async checkSubmission(){
    const botId=this.state.selected,submission=this.state.draft.submission;
    if(!submission||!botId||this.checking)return;
    this.checking=true;
    try{
      const command=await this.api<{state:string;error:string|null}>('/api/commands/'+submission.id);
      if(this.state.selected!==botId||this.state.draft.submission?.id!==submission.id)return;
      const {id,text}=submission;
      if(command.state==='completed'||command.state==='stopped'){
        await this.refresh();
        if(this.state.selected!==botId||this.state.draft.submission?.id!==id)return;
        const index=this.state.messages.findIndex(message=>message.id==='command-user-'+id);
        const answer=nextChatMessage(this.state.messages,index);
        const work=this.state.work.find(item=>item.id===id);
        if(index>=0 && answer && ['assistant','assistant_stopped'].includes(answer.role) && work?.progress.state===command.state)this.save({...this.state.draft,submission:null});
      }
      else if(command.state==='failed'||command.state==='interrupted')this.save({...this.state.draft,submission:{id,text,kind:command.state,error:command.error}});
      else this.save({...this.state.draft,submission:{id,text,kind:'pending'}});
    }catch(e){
      if(this.state.selected!==botId||this.state.draft.submission?.id!==submission.id)return;
      if(e instanceof ApiError&&e.status===404){if(submission.kind!=='uncertain-busy')await this.submit(botId,submission);return}
      if(submission.kind!=='uncertain-busy')this.save({...this.state.draft,submission:{id:submission.id,text:submission.text,kind:'unknown',error:String(e)}});
    }finally{this.checking=false}
  }
  openSetup(){const form=++this.setupGeneration,modelGeneration=this.setupModelGeneration,reasoningGeneration=this.setupReasoningGeneration,dataset=this.dataset,retained=this.retainedCreation;this.update({setup:retained??{kind:'create',name:'',instructions:'',provider:'',model:'',operationId:null,status:''}});if(!retained)void this.creationDefaults().then(defaults=>{const current=this.state.setup;if(this.dataset===dataset&&this.setupGeneration===form&&current.kind==='create'&&!current.operationId&&!current.provider)this.update({setup:{...current,provider:defaults.provider,...(this.setupModelGeneration===modelGeneration?{model:defaults.model??''}:{}),...(this.setupReasoningGeneration===reasoningGeneration?{reasoning:defaults.reasoning??'default'}:{})}})}).catch(error=>{const current=this.state.setup;if(this.dataset===dataset&&this.setupGeneration===form&&current.kind==='create'&&!current.operationId)this.update({setup:{...current,status:String(error)}})})}
  async setupProvider(provider:string){const setup=this.state.setup;if(setup.kind!=='create'||setup.operationId)return;const form=++this.setupGeneration,dataset=this.dataset,modelGeneration=++this.setupModelGeneration,reasoningGeneration=++this.setupReasoningGeneration;this.update({setup:{...setup,provider,model:'',reasoning:'default'}});try{const defaults=await this.providerDefaults();const pair=defaults.providers[provider];const current=this.state.setup;if(this.dataset===dataset&&this.setupGeneration===form&&current.kind==='create'&&!current.operationId&&current.provider===provider)this.update({setup:{...current,...(this.setupModelGeneration===modelGeneration?{model:pair?.model??''}:{}),...(this.setupReasoningGeneration===reasoningGeneration?{reasoning:pair?.reasoning??'default'}:{})}})}catch{/* Creation remains possible while defaults are unavailable. */}}
  setupField(field:'name'|'instructions'|'provider'|'model'|'reasoning',value:string){if(field==='model')this.setupModelGeneration++;if(field==='reasoning')this.setupReasoningGeneration++;const setup=this.state.setup;if(setup.kind==='create'&&!setup.operationId)this.update({setup:{...setup,[field]:value}})}
  setupToolMode(value:string){const setup=this.state.setup;if(setup.kind==='create'&&!setup.operationId)this.update({setup:{...setup,toolMode:value===''?undefined:parseToolMode(value)}})}
  setupImage(image:AgentImageInput){const setup=this.state.setup;if(setup.kind==='create'&&!setup.operationId)this.update({setup:{...setup,image}})}
  closeSetup(){this.setupGeneration++;if(this.state.setup.kind==='create')this.retainedCreation=this.state.setup;this.update({setup:{kind:'closed'}})}
  cancelSetup(){this.setupGeneration++;if(this.state.setup.kind==='create'&&this.state.setup.operationId)this.retainedCreation=this.state.setup;else this.retainedCreation=null;this.update({setup:{kind:'closed'}})}
  async create(retry=false){const dataset=this.dataset;let s=this.state.setup;if(!dataset||s.kind!=='create')return;if(!s.name.trim()){this.update({setup:{...s,status:'Enter a name for your agent.'}});return;}if(!s.operationId&&!s.provider){this.update({setup:{...s,status:'Choose a provider for this agent or set creation defaults in Settings.'}});return;}if(!s.operationId)s={...s,operationId:crypto.randomUUID(),explicitChoices:true};const key=prefix+'creation:'+dataset+':'+s.operationId;this.update({setup:s});try{if(!await this.claim(key))throw Error('Creation is in use');if(this.dataset!==dataset)return;localStorage.setItem(key,JSON.stringify(s));this.retainedCreation=s}catch{this.update({setup:{...s,status:'Browser storage unavailable. Creation is blocked.'}});return}this.update({setup:{...s,status:retry?'Retrying the same operation.':'Creating…'}});try{const provider=s.provider;const bot=await this.api<Bot>('/api/bots',{operationId:s.operationId,name:s.name,instructions:s.instructions,...(provider?{provider}:{}),...(s.explicitChoices?{model:s.model.trim()||null,reasoning:s.reasoning&&s.reasoning!=='default'?s.reasoning:null}:{...(s.model.trim()?{model:s.model.trim()}:{}),...(s.reasoning&&s.reasoning!=='default'?{reasoning:s.reasoning}:{})}),...(s.toolMode===undefined?{}:{toolMode:s.toolMode}),image:s.image??{kind:'initials'}},undefined,s.image?.kind==='upload-data'?agentImageBodyType:undefined);if(this.dataset!==dataset)return;localStorage.removeItem(key);this.retainedCreation=null;this.update({setup:{kind:'closed'},selected:bot.id,notice:'Agent created. Provider readiness has not been verified.'});sessionStorage.setItem('staf-selected-agent',bot.id);await this.loadDraft(bot.id);await this.refresh()}catch(e){if(this.dataset!==dataset)return;this.update({setup:{...s,status:'Result may be uncertain. Your form is retained. Check status or retry the same operation. '+String(e)}})}}
  async checkCreate(){const dataset=this.dataset;const s=this.state.setup;if(!dataset||s.kind!=='create'||!s.operationId)return;try{const bot=await this.api<Bot>('/api/bot-creations/'+s.operationId);if(this.dataset!==dataset)return;localStorage.removeItem(prefix+'creation:'+dataset+':'+s.operationId);this.retainedCreation=null;this.update({setup:{kind:'closed'},selected:bot.id,notice:'Recovered the created agent.'});sessionStorage.setItem('staf-selected-agent',bot.id);await this.loadDraft(bot.id);await this.refresh()}catch(e){if(this.dataset!==dataset)return;this.update({setup:{...s,status:'Status unavailable. A missing record does not prove an in-flight request cannot finish. '+String(e)}})}}
  async plugins() {return this.api<Array<{id:string;name:string;description:string;connected:boolean;enabled:boolean;config:{teamId:string;userId:string;channelId:string;botId:string}|null;accountId:string|null;agentAccess:boolean;status:string;events:Array<{eventId:string;commandId:string;state:string;detail:string|null}>}>>('/api/plugins');}
  async pluginAction(action:'connect'|'enable'|'disable'|'disconnect'|'delete-config'|'access',body:object={}) {return this.api('/api/plugins/slack/'+action,body);}
  async saveOpenRouter(key:string){await this.api('/api/openrouter-connection',{key});await this.refresh()}
  async disconnectOpenRouter(){await this.api('/api/openrouter-connection/disconnect',{});await this.refresh()}
  private reconcileAuth(attempt:Workspace['authAttempt']){
    const previous=this.state.authAttempt;
    if(attempt?.id===previous?.id&&attempt?.phase===previous?.phase)return;
    this.update({notices:this.state.notices.filter(n=>n.topic!=='auth'),authStatus:'',...(attempt?.phase==='waiting'&&attempt.id===this.state.authUrlAttemptId?{}:{authUrl:'',authUrlAttemptId:''})});
    if(!attempt)return;
    if(attempt.phase==='succeeded')this.notify('ChatGPT sign-in saved. Account and model access have not been verified.','success','auth');
    else if(['failed','expired','cancelled','canceled'].includes(attempt.phase))this.notify('Sign-in '+attempt.phase+'. You can try again.',attempt.phase==='failed'||attempt.phase==='expired'?'error':'info','auth');
    else if(attempt.phase!=='waiting')this.notify('Sign-in '+attempt.phase+'…','info','auth');
  }
  async startAuth(){
    if(this.state.authStarting||this.state.authAttempt&&['waiting','exchanging','committing'].includes(this.state.authAttempt.phase))return;
    // Reserve the tab synchronously, before the asynchronous authorization setup.
    let tab:Window|null=null;
    try{tab=window.open('about:blank','_blank');if(tab)tab.opener=null}catch{/* Manual link remains available. */}
    this.update({authStarting:true,authStatus:'Starting sign-in…',notices:this.state.notices.filter(n=>n.topic!=='auth')});
    try{
      const result=await this.api<{id:string;phase:string;url:string}>('/api/codex-auth/start',{});
      this.update({authAttempt:{id:result.id,phase:result.phase},authUrl:result.url,authUrlAttemptId:result.id,authStatus:''});
      let opened=false;
      try{if(tab&&!tab.closed){tab.location.replace(result.url);opened=true}}catch{/* Keep the link for the same attempt. */}
      this.notify(opened?'Sign-in opened in a new tab. Complete it, then return here.':'The sign-in tab was blocked. Select Continue sign-in below.','info','auth');
      await this.refresh();
    }catch{
      tab?.close();
      const message='Sign-in could not start or its result is uncertain. Check the attempt below; cancel it before retrying if needed.';
      await this.refresh();this.update({authUrl:'',authUrlAttemptId:'',authStatus:message});this.notify(message,'error','auth');
    }finally{this.update({authStarting:false})}
  }
  async cancelAuth(){const attempt=this.state.authAttempt;if(!attempt)return;try{await this.api('/api/codex-auth/'+attempt.id+'/cancel',{});this.update({authUrl:'',authUrlAttemptId:'',authStatus:''});await this.refresh()}catch{const message='Could not cancel sign-in. Check connection and retry.';this.update({authStatus:message});this.notify(message,'error','auth')}}
  async signOutAuth(){try{await this.api('/api/codex-auth/logout',{});this.update({authUrl:'',authUrlAttemptId:'',authStatus:'',notices:this.state.notices.filter(n=>n.topic!=='auth')});await this.refresh();this.notify('ChatGPT sign-in removed from this instance.','success','auth')}catch(e){this.update({authStatus:'Could not sign out. Check connection and retry.'});this.notify('Could not sign out. Check connection and retry.','error','auth')}}
  async core() { return parseCore(await this.api<unknown>('/api/core')); }
  async saveCore(revision:string,content:string|null) { return parseCore(await this.api<unknown>('/api/core',{revision,content})); }
  async toolDefaults(){const value=await this.api<unknown>('/api/tool-defaults');if(!isRecord(value)||typeof value.revision!=='number'||typeof value.clock!=='boolean'||typeof value.memory!=='boolean'||typeof value.web!=='boolean'||typeof value.files!=='boolean')throw Error('Invalid tool defaults');return {revision:value.revision,clock:value.clock,memory:value.memory,web:value.web,files:value.files}}
  async saveToolDefaults(value:Awaited<ReturnType<Controller['toolDefaults']>>){return this.api('/api/tool-defaults',value)}
  async memorySensitivity(){return z.object({revision:z.number().int().positive(),mode:z.enum(['model','review-all']),terms:z.array(z.string())}).parse(await this.api<unknown>('/api/memory-sensitivity'))}
  async saveMemorySensitivity(value:Awaited<ReturnType<Controller['memorySensitivity']>>){return this.api('/api/memory-sensitivity',value)}
  private async memoryProposalRequest(path:string,body?:unknown,signal?:AbortSignal):Promise<unknown>{
    const token=this.token;
    try {const value=await this.api<unknown>(path,body,signal);signal?.throwIfAborted();if(!token || this.token!==token)throw Error('Memory access is no longer available.');return value;}
    catch(error){if(!signal?.aborted && this.token===token && error instanceof ApiError && error.status===401){this.token='';this.generation++;this.watchResponse(null);localStorage.removeItem('staf-token');this.update({connection:{kind:'pairing',message:'Pairing expired or was revoked.'}});}throw error;}
  }
  async memoryProposals(botId:string,signal?:AbortSignal){return z.array(z.object({id:z.string(),scope:z.enum(['bot','user']),operation:z.enum(['create','update']),targetId:z.string().nullable(),targetVersion:z.number().nullable(),text:z.string(),fingerprint:z.string()})).parse(await this.memoryProposalRequest('/api/memory-proposals/'+encodeURIComponent(botId),undefined,signal))}
  async decideMemoryProposal(id:string,fingerprint:string,decision:'confirm'|'deny'){return z.object({decision:z.enum(['confirm','deny']),sharedConfirmationRequired:z.boolean()}).parse(await this.memoryProposalRequest('/api/memory-proposals/'+encodeURIComponent(id)+'/'+decision,{fingerprint}))}
  async searchConfig(){const value=await this.api<unknown>('/api/search-config');if(!isRecord(value)||typeof value.revision!=='number'||!isNullableString(value.origin))throw Error('Invalid search configuration');return {revision:value.revision,origin:value.origin}}
  async saveSearchConfig(revision:number,origin:string|null){return this.api('/api/search-config',{revision,origin})}
  async creationDefaults(){const value=await this.api<unknown>('/api/creation-defaults');if(!isRecord(value)||typeof value.revision!=='number'||typeof value.provider!=='string'||!isNullableString(value.model)||!isNullableString(value.reasoning))throw Error('Invalid creation defaults');return {revision:value.revision,provider:value.provider,model:value.model,reasoning:value.reasoning,toolMode:parseToolMode(value.toolMode)}}
  async saveCreationMode(defaults:Awaited<ReturnType<Controller['creationDefaults']>>,toolMode:ToolMode){return this.api('/api/creation-defaults',{...defaults,toolMode})}
  async saveCreationDefaults(defaults:Awaited<ReturnType<Controller['creationDefaults']>>,provider:string,model:string,reasoning:string){return this.api('/api/creation-defaults',{...defaults,provider,model:model.trim()||null,reasoning:reasoning==='default'?null:reasoning})}
  async providerDefaults(){return parseProviderDefaults(await this.api<unknown>('/api/provider-defaults'))}
  async saveProviderDefault(revision:string,provider:string,model:string,reasoning:string){return parseProviderDefaults(await this.api<unknown>('/api/provider-defaults',{revision,provider,model:model.trim()||null,reasoning:reasoning==='default'?null:reasoning}))}
  async models(provider:string){return parseModelCatalog(await this.api<unknown>('/api/models',{provider}))}
  async selectProvider(profile:BotProfile,provider:string,edit:{model?:string|null;reasoning?:string|null}={}){const result=parseSelection(await this.api<unknown>('/api/bots/'+profile.id+'/selection',{revision:profile.revision,provider,...edit}));await this.refresh();return result}
  async agentImage(assetId:string,signal:AbortSignal):Promise<Blob> {
    const dataset=this.dataset,token=this.token;
    if(!dataset||!token)throw Error('Image access is unavailable.');
    const response=await fetch('/api/agent-images/'+encodeURIComponent(assetId),{headers:{Authorization:'Bearer '+token,'X-Staf-Dataset':dataset},signal,cache:'no-store'});
    if(!response.ok||response.headers.get('content-type')!=='image/png'||response.headers.get('X-Staf-Dataset')!==dataset)throw Error('Image unavailable.');
    const blob=await response.blob();signal.throwIfAborted();
    if(this.dataset!==dataset||this.token!==token||blob.size>agentImageByteLimit)throw Error('Image access changed.');
    return blob;
  }
  async botProfile(id:string){return parseSelection(await this.api<unknown>('/api/bots/'+id))}
  async memories(scope: MemoryScope, signal: AbortSignal): Promise<Memory[]> {
    const token = this.token;
    try {
      const path = scope.kind === 'user' ? 'user' : 'bot/' + encodeURIComponent(scope.botId);
      const result = await this.api<unknown>('/api/memories/' + path, undefined, signal);
      signal.throwIfAborted();
      if (!token || this.token !== token) throw Error('Memory access is no longer available.');
      return parseMemories(result, scope);
    } catch (error) {
      if (!signal.aborted && this.token === token && error instanceof ApiError && error.status === 401) {
        this.token = '';
        this.generation++;
        this.watchResponse(null);
        localStorage.removeItem('staf-token');
        this.update({connection: {kind: 'pairing', message: 'Pairing expired or was revoked.'}});
      }
      throw error;
    }
  }
  async saveBotProfile(profile:BotProfile,edit:{name:string;provider:string;model:string;reasoning:string;instructions:string;toolMode:ToolMode;image?:AgentImageInput}){await this.api('/api/bots/'+profile.id+'/profile',{revision:profile.revision,name:edit.name,description:profile.description,instructions:edit.instructions,provider:edit.provider,model:edit.model.trim()||null,reasoning:edit.reasoning==='default'?null:edit.reasoning,toolMode:edit.toolMode,...(edit.image===undefined?{}:{image:edit.image})},undefined,edit.image?.kind==='upload-data'?agentImageBodyType:undefined);await this.refresh()}
  async setArchived(profile:BotProfile,archived:boolean){await this.api('/api/bots/'+profile.id+'/'+(archived?'archive':'restore'),{revision:profile.revision});await this.refresh()}
  async stopTask(id:string){try{await this.api('/api/tasks/'+id+'/stop',{});await this.refresh()}catch{this.notify('Could not stop task. Refresh and retry.','error');await this.refresh()}}
  async decide(item:Extract<InboxItem,{kind:'approval'}>,decision:'approve'|'deny'){const route={clock:'approvals',web:'web-approvals',search:'search-approvals',shell:'shell-approvals',disclosure:'disclosures'}[item.approvalKind];try{await this.api('/api/'+route+'/'+item.id+'/'+decision,{});this.update({notice:'Decision recorded.'});await this.refresh()}catch(e){this.update({actionError:'Decision failed or is uncertain. Refresh before trying again.'});this.notify('Decision failed or is uncertain. Refresh before trying again.','error');await this.refresh()}}
}
