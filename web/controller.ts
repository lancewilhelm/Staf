import {parseResolvedReference, parseSelectedReferences} from './source-selection';
import type {WorkspaceReference, SelectedReference} from '../src/workspace-reference-types';
export type ArtifactFormat = 'text'|'markdown'|'csv';
export type ArtifactSource = {sessionId:string;messageId:string};
export type ArtifactCreateInput = {operationId:string;name:string;format:ArtifactFormat;content:string;source?:ArtifactSource};
export type ArtifactSummary = {id:string;name:string;format:ArtifactFormat;revision:number;createdAt:string;updatedAt:string;sourceSessionId:string|null;sourceMessageId:string|null};
export type ArtifactRevisionInfo = {revision:number;digest:string;createdAt:string};
export type ArtifactRevision = {id:string;name:string;format:ArtifactFormat;revision:number;content:string;digest:string;createdAt:string;artifactCreatedAt:string;sourceSessionId:string|null;sourceMessageId:string|null};
import type { DocumentSummary, DocumentExcerpt } from '../src/document-types';
import type {ToastNotice} from './toast-notice';
import {responseEvents} from './response-stream';
import type { Memory, MemoryScope } from '../src/memory-types';

export type ModelCatalog={models:Array<{id:string;label:string;reasoning:string[]|null;reasoningStatus:string}>;defaultModel?:string};
export type Bot={revision?:string;id:string;name:string;provider:string;model:string|null;archived:boolean};
export type BotProfile=Bot & {revision:string;instructions:string;description:string;reasoning:string|null;configDir:string;providerChoices?:Record<string,{model:string|null;reasoning:string|null}>};
export type Message={id:string;role:string;content:string};
export type ResponseProgress={id:string;botId:string;state:'accepted'|'running'|'stopping'|'stopped'|'completed'|'failed'|'interrupted';text:string;error:string|null};
export type ChatWork={references?:SelectedReference[];id:string;progress:ResponseProgress;events:Array<{id:number;type:string;name:string;success:number|null;detail:string|null}>};
export type InboxItem={kind:'question';id:string;botId:string|null;attemptId:string;text:string}|{kind:'approval';approvalKind:'clock'|'web'|'search'|'shell'|'disclosure';id:string;botId:string|null;work:{kind:'task'|'command';id:string};detail:unknown};
type SubmissionIdentity={id:string;text:string;references?:SelectedReference[]};
export type Submission=SubmissionIdentity & (
  | {kind:'submitting'|'submitting-uncertain'|'pending'}
  | {kind:'unknown'|'uncertain-busy'|'busy'|'rejected';error:string}
  | {kind:'failed'|'interrupted';error:string|null}
);
export type Draft={text:string;submission:Submission|null;references?:SelectedReference[]};
export type Connection={kind:'connecting'}|{kind:'pairing';message:string}|{kind:'ready'}|{kind:'offline';message:string};
export type Setup={kind:'closed'}|{kind:'create';name:string;instructions:string;provider:string;model:string;reasoning?:string;operationId:string|null;status:string};
export type Workspace={datasetId?:string;connection:Connection;setup:Setup;bots:Bot[];selected:string|null;sessionId:string|null;messages:Message[];work:ChatWork[];response:ResponseProgress|null;responseConnection:'connecting'|'connected'|'reconnecting';inbox:InboxItem[];credential:'signed-in'|'signed-out'|'unknown';openrouter:'saved'|'missing'|'unknown'|'error';authAttempt:{id:string;phase:string}|null;authUrl:string;authUrlAttemptId:string;freshness:string;notice:string;notices:ToastNotice[];authStarting:boolean;authStatus:string;actionError:string;draft:Draft;draftReady:boolean;legacyRecords:Array<{key:string;value:string}>};
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
 return {id:value.id,name:value.name,provider:value.provider,model:value.model,archived:value.archived,revision:value.revision,instructions:value.instructions,description:value.description,reasoning:value.reasoning,configDir:value.configDir,...(value.providerChoices===undefined?{}:{providerChoices:value.providerChoices})};
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
  return isRecord(value)&&typeof value.id==='string'&&value.botId===botId&&typeof value.state==='string'&&['accepted','running','stopping','stopped','completed','failed','interrupted'].includes(value.state)&&typeof value.text==='string'&&(value.error===null||typeof value.error==='string');
}
const prefix='staf-workspace-v1:';
function normalizeDraft(draft:Draft):Draft {
  draft={...draft,...(draft.references===undefined?{}:{references:parseSelectedReferences(draft.references)}),submission:draft.submission?{...draft.submission,...(draft.submission.references===undefined?{}:{references:parseSelectedReferences(draft.submission.references)})}:null};
  const submission=draft.submission;
  if(submission?.kind==='submitting'||submission?.kind==='submitting-uncertain')return {...draft,submission:{id:submission.id,text:submission.text,references:submission.references,kind:'unknown',error:'Recovering the original request.'}};
  if(submission && submission.kind==='busy' && 'uncertain' in submission && submission.uncertain===true)return {...draft,submission:{id:submission.id,text:submission.text,references:submission.references,kind:'uncertain-busy',error:'Another response is in progress. The original request may still arrive.'}};
  return draft;
}
export class Controller {
  private dataset:string|null=null; private writer=crypto.randomUUID(); private checking=false; private listeners=new Set<()=>void>(); private generation=0; private token=localStorage.getItem('staf-token')||''; private currentKey=''; private timer:number; private responseStream:{botId:string;controller:AbortController}|null=null;
  state:Workspace={connection:{kind:'connecting'},setup:{kind:'closed'},bots:[],selected:null,sessionId:null,messages:[],work:[],response:null,responseConnection:'connecting',inbox:[],credential:'unknown',openrouter:'unknown',authAttempt:null,authUrl:'',authUrlAttemptId:'',freshness:'',notice:'',notices:[],authStarting:false,authStatus:'',actionError:'',draft:{text:'',submission:null},draftReady:false,legacyRecords:[]};
  constructor(){this.timer=window.setInterval(()=>{if(document.visibilityState==='visible')void this.refresh()},1000);window.addEventListener('online',()=>void this.refresh());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void this.refresh()});void this.removeObsoleteRecords();void this.refresh()}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn)};
  snapshot=()=>this.state;
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
      const changed=this.dataset!==null;this.dataset=data.id;this.update({datasetId:data.id});this.draftLoad++;this.currentKey='';this.retainedCreation=null;this.watchResponse(null);
      if(changed)this.update({setup:{kind:'closed'},bots:[],selected:null,sessionId:null,messages:[],work:[],response:null,draft:{text:'',submission:null},draftReady:false,notice:'The development dataset changed. Previous browser drafts and pending creations remain saved separately.'});
      void this.restoreCreation(data.id);
    }
    return true;
  }
  private async api<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{const dataset=this.dataset;if(!dataset)throw Error('Dataset identity unavailable');const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'X-Staf-Dataset':dataset,...(body===undefined?{}:{'Content-Type':'application/json'}),...(this.token?{Authorization:'Bearer '+this.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});const data:unknown=await response.json();const responseDataset=response.headers.get('X-Staf-Dataset');if(this.dataset!==dataset||(responseDataset!==null&&responseDataset!==dataset)||(response.ok&&responseDataset===null))throw Error('Dataset changed. Refresh before retrying.');if(!response.ok){const message=typeof data==='object'&&data!==null&&'error'in data&&typeof data.error==='string'?data.error:'Request failed';throw new ApiError(message,response.status)}return data as T}
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
          if(event.type==='snapshot' && (event.response===null || isResponseProgress(event.response,botId)))next=event.response;
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
  async refresh(){const gen=++this.generation;try{if(!await this.syncDataset(gen))return;if(!this.token){this.update({connection:{kind:'pairing',message:''}});return}const [bots,allInbox,credential,current,openrouter]=await Promise.all([this.api<Bot[]>('/api/bots'),this.api<InboxItem[]>('/api/inbox'),this.api<{signedIn:boolean}>('/api/codex-auth/credential'),this.api<{attempt:{id:string;phase:string}|null}>('/api/codex-auth/current'),this.api<{saved:boolean}>('/api/openrouter-connection').catch(()=>({saved:null}))]);const inbox=allInbox.filter(item=>item.kind==='approval'&&item.work.kind==='command');const preferred=this.state.selected||sessionStorage.getItem('staf-selected-agent');const selected=preferred && bots.some(b=>b.id===preferred&&!b.archived)?preferred:bots.find(b=>!b.archived)?.id??null;const chat=selected?await this.api<{sessionId:string;messages:Message[];requests:ChatWork[]}>('/api/bots/'+selected+'/chat-work'):{sessionId:null,messages:[],requests:[]};const {messages,requests,sessionId}=chat;const work=requests.map(item=>({...item,references:parseSelectedReferences(item.references)}));if(gen!==this.generation)return;const changed=selected!==this.state.selected||sessionId!==this.state.sessionId;if(changed)this.update({selected,sessionId,draft:{text:'',submission:null},draftReady:false,response:null});if(changed||!this.state.draftReady){await this.loadDraft(selected,gen);if(gen!==this.generation)return;}this.reconcileAuth(current.attempt);this.update({connection:{kind:'ready'},bots,selected,messages,...(changed?{response:null}:{}),work,inbox,credential:credential.signedIn?'signed-in':'signed-out',openrouter:openrouter.saved===null?'error':openrouter.saved?'saved':'missing',authAttempt:current.attempt,freshness:''});this.watchResponse(selected);void this.recoverLegacy();if(!this.state.draft.text&&!this.state.draft.submission&&!this.state.draft.references?.length)void this.recoverNext();if(this.state.draft.submission && (['pending','unknown'].includes(this.state.draft.submission.kind)||this.state.draft.submission.kind==='uncertain-busy'))void this.checkSubmission()}catch(e){if(gen!==this.generation)return;if(e instanceof ApiError&&e.status===401){this.token='';this.watchResponse(null);localStorage.removeItem('staf-token');this.update({connection:{kind:'pairing',message:'Pairing expired or was revoked.'}})}else this.update({connection:{kind:'offline',message:'Connection unavailable. Showing the last successful update.'},freshness:String(e)})}}
  async select(id:string){
    if(id===this.state.selected)return;
    sessionStorage.setItem('staf-selected-agent',id);this.generation++;
    this.currentKey='';this.update({selected:id,sessionId:null,messages:[],work:[],response:null,draft:{text:'',submission:null},draftReady:false});
    this.watchResponse(id);if(this.state.selected===id)void this.refresh();
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
      if(id && this.state.sessionId){
        const sessionId=this.state.sessionId;
        const own=prefix+this.dataset+':'+this.writer+':'+id+':'+sessionId;
        const candidates=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>!!key && key.startsWith(prefix+this.dataset+':') && key.endsWith(':'+id+':'+sessionId) && !key.includes(':creation:'));
        const ordered=[...candidates.filter(key=>this.claims.has(key)),...candidates.filter(key=>!this.claims.has(key))];
        let key=own;
        for(const candidate of ordered){
          const saved=localStorage.getItem(candidate);if(!saved)continue;
          const parsed:unknown=JSON.parse(saved);
          if(!isRecord(parsed)||typeof parsed.text!=='string'||(!parsed.text && !parsed.submission && !(Array.isArray(parsed.references)&&parsed.references.length)))continue;
          if(await this.claim(candidate)){key=candidate;break;}
        }
        if(key===own)await this.recoverLegacyDraft(id,sessionId,own,()=>load===this.draftLoad&&this.state.sessionId===sessionId&&(expectedGeneration===undefined||expectedGeneration===this.generation));
        if(!await this.claim(key))throw Error('Draft is in use');
        if(load!==this.draftLoad || (expectedGeneration!==undefined && expectedGeneration!==this.generation))return;
        this.currentKey=key;
        const saved=localStorage.getItem(key);
        if(saved)draft=normalizeDraft(JSON.parse(saved));
      }
    }catch{if(load===this.draftLoad && (expectedGeneration===undefined || expectedGeneration===this.generation)){this.currentKey='';this.update({actionError:'Browser storage or locking is unavailable. Sending is blocked.'});this.notify('Browser storage or locking is unavailable. Sending is blocked.','error')}}
    if(load===this.draftLoad && (expectedGeneration===undefined || expectedGeneration===this.generation))this.update({draft,draftReady:!!this.currentKey});
  }
  private earlierDraftIdentity(key:string):{botId:string;sessionId:string|null}|null {
    if(!this.dataset||!key.startsWith(prefix)||key.startsWith(prefix+'creation:')||key.startsWith(prefix+'session-create:'))return null;
    const parts=key.slice(prefix.length).split(':');
    if(parts.length===2&&parts[0]&&parts[1])return {botId:parts[1],sessionId:null};
    if(parts[0]!==this.dataset||!parts[1]||!parts[2])return null;
    if(parts.length===3)return {botId:parts[2],sessionId:null};
    if(parts.length===4&&parts[3])return {botId:parts[2],sessionId:parts[3]};
    return null;
  }
  private async recoverLegacyDraft(botId:string,sessionId:string,target:string,valid:()=>boolean):Promise<Draft|null> {
    const dataset=this.dataset;
    const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>{if(!key)return false;const identity=this.earlierDraftIdentity(key);return identity?.botId===botId&&identity.sessionId===null;});
    for(const key of keys){
      const raw=localStorage.getItem(key);if(!raw)continue;
      let saved:unknown;try{saved=JSON.parse(raw);}catch{continue;}
      if(!isRecord(saved)||typeof saved.text!=='string'||!isRecord(saved.submission)||typeof saved.submission.id!=='string'||!/^[\w-]{1,100}$/.test(saved.submission.id)||typeof saved.submission.text!=='string')continue;
      try {
        const command=await this.api<{botId:string;sessionId:string;content:string;references?:unknown}>('/api/commands/'+encodeURIComponent(saved.submission.id));
        if(command.botId!==botId||command.sessionId!==sessionId||command.content!==saved.submission.text||this.dataset!==dataset||!valid()||localStorage.getItem(key)!==raw)continue;
        const references=parseSelectedReferences(command.references);
        if(saved.submission.references!==undefined&&JSON.stringify(parseSelectedReferences(saved.submission.references).map(source=>source.reference))!==JSON.stringify(references.map(source=>source.reference)))continue;
        const draft:Draft={text:saved.text,references:parseSelectedReferences(saved.references),submission:{id:saved.submission.id,text:saved.submission.text,references,kind:'unknown',error:'Recovering the original request.'}};
        const previous=localStorage.getItem(target);
        if(previous!==null){const existing=normalizeDraft(JSON.parse(previous));if(existing.text||existing.submission||existing.references?.length)continue;}
        if(!await this.claim(key)||!await this.claim(target))continue;
        if(this.dataset!==dataset||!valid()||localStorage.getItem(key)!==raw||localStorage.getItem(target)!==previous)continue;
        localStorage.setItem(target,JSON.stringify(draft));localStorage.removeItem(key);return draft;
      }catch{/* An unverified record remains available for copy-out. */}
    }
    return null;
  }
  private async recoverNext(){
    const id=this.state.selected,current=this.currentKey,sessionId=this.state.sessionId;
    if(this.recovering||!id||!sessionId||!current||this.state.draft.text||this.state.draft.submission||this.state.draft.references?.length)return;
    this.recovering=true;
    try{
      const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>!!key&&key!==current&&key.startsWith(prefix+this.dataset+':')&&key.endsWith(':'+id+':'+sessionId)&&!key.includes(':creation:'));
      for(const key of keys){
        const saved=localStorage.getItem(key);if(!saved)continue;
        const candidate=normalizeDraft(JSON.parse(saved));if(typeof candidate.text!=='string'||(!candidate.text&&!candidate.submission&&!candidate.references?.length))continue;
        if(!await this.claim(key))continue;
        if(this.currentKey!==current||this.state.selected!==id||this.state.draft.text||this.state.draft.submission||this.state.draft.references?.length)return;
        const latest=localStorage.getItem(key);if(!latest)continue;
        const draft=normalizeDraft(JSON.parse(latest));if(typeof draft.text!=='string'||(!draft.text&&!draft.submission&&!draft.references?.length))continue;
        this.currentKey=key;this.update({draft});void this.refresh();return;
      }
      const draft=await this.recoverLegacyDraft(id,sessionId,current,()=>this.currentKey===current&&this.state.selected===id&&this.state.sessionId===sessionId&&!this.state.draft.text&&!this.state.draft.submission&&!this.state.draft.references?.length);
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
        const oldDrafts=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>{if(!key||!key.startsWith(prefix+dataset+':'))return false;const parts=key.slice(prefix.length).split(':');if(parts[2]!==this.state.selected || (parts.length!==3 && !(parts.length===4 && parts[3]!==this.state.sessionId)))return false;try{const raw=localStorage.getItem(key);const value:unknown=raw?JSON.parse(raw):null;return isRecord(value)&&((typeof value.text==='string'&&!!value.text)||!!value.submission)}catch{return false}});
        const records=[...keys,...oldDrafts].flatMap(key=>{const value=localStorage.getItem(key);return value===null?[]:[{key,value}]});
        if(JSON.stringify(records)!==JSON.stringify(this.state.legacyRecords))this.update({legacyRecords:records});
      }
    }finally{this.legacyChecking=false}
  }
  private async restoreCreation(dataset:string){
    try{
      const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>!!key&&key.startsWith(prefix+'creation:'+dataset+':'));
      for(const key of keys){
        if(!await this.claim(key))continue;
        const value=localStorage.getItem(key);if(!value)continue;
        const saved:unknown=JSON.parse(value);
        if(!isRecord(saved)||saved.kind!=='create'||typeof saved.operationId!=='string'||key!==prefix+'creation:'+dataset+':'+saved.operationId||typeof saved.name!=='string'||typeof saved.instructions!=='string'||typeof saved.provider!=='string'||typeof saved.model!=='string'||(saved.reasoning!==undefined&&(typeof saved.reasoning!=='string'||!['default','none','minimal','low','medium','high','xhigh','max'].includes(saved.reasoning))))continue;
        const setup:Extract<Setup,{kind:'create'}>={kind:'create',operationId:saved.operationId,name:saved.name,instructions:saved.instructions,provider:saved.provider,model:saved.model,...(saved.reasoning===undefined?{}:{reasoning:saved.reasoning}),status:'Recovered creation. Check status or retry the same operation.'};
        if(this.dataset!==dataset||this.state.setup.kind!=='closed'||this.retainedCreation)return;
        this.retainedCreation=setup;this.update({setup});return;
      }
    }catch{this.update({actionError:'Could not recover the saved agent creation.'});this.notify('Could not recover the saved agent creation.','error')}
  }
  async send(retry=false){
    const botId=this.state.selected,sessionId=this.state.sessionId,draft=this.state.draft;
    if(!botId||!sessionId||(!retry&&!draft.text.trim()))return;
    if(this.state.response&&['accepted','running','stopping'].includes(this.state.response.state))return;
    let submission=draft.submission;
    if(!retry){if(submission)return;submission={kind:'submitting',id:crypto.randomUUID(),text:draft.text,references:draft.references}}
    else if(submission && (submission.kind==='failed'||submission.kind==='interrupted'))submission={kind:'submitting',id:crypto.randomUUID(),text:submission.text,references:submission.references};
    if(!submission)return;
    const current=submission,uncertain=current.kind==='unknown'||current.kind==='uncertain-busy'||current.kind==='submitting-uncertain';
    if(!this.save({...draft,text:retry?draft.text:'',references:retry?draft.references:[],submission:{id:current.id,text:current.text,references:current.references,kind:uncertain?'submitting-uncertain':'submitting'}}))return;
    const bot=this.state.bots.find(item=>item.id===botId);
    const setupError=bot?.provider==='codex'&&this.state.credential==='signed-out'?'Connect ChatGPT in Settings to send.':bot?.provider==='openrouter'&&this.state.openrouter!=='saved'?'Connect OpenRouter in Settings to send.':bot&&bot.provider!=='demo'&&!bot.model?.trim()?'Choose a model for this agent to send.':null;
    if(setupError){this.save({...this.state.draft,submission:{id:current.id,text:current.text,references:current.references,kind:uncertain?'unknown':'rejected',error:setupError}});return}
    await this.submit(botId,sessionId,current);
  }
  async stopResponse(){const response=this.state.response;if(!response||!['accepted','running','stopping'].includes(response.state))return;try{await this.api('/api/commands/'+encodeURIComponent(response.id)+'/stop',{});}catch(e){this.update({actionError:'Could not stop the response. Retry Stop while the response is active.'});this.notify('Could not stop the response. Retry Stop.','error')}}
  private async submit(botId:string,sessionId:string,submission:Submission){
    const {id,text,references}=submission,uncertain=submission.kind==='unknown'||submission.kind==='uncertain-busy'||submission.kind==='submitting-uncertain';
    try{
      const result=await this.api<{kind:string}>('/api/commands',{id,botId,sessionId,content:text,references:references?.map(source=>source.reference)??[]});
      if(this.state.selected!==botId||this.state.sessionId!==sessionId||this.state.draft.submission?.id!==id)return;
      if(result.kind==='busy'){this.save({...this.state.draft,submission:uncertain?{id,text,references:submission.references,kind:'uncertain-busy',error:'Another response is in progress. The original request may still arrive.'}:{id,text,references:submission.references,kind:'busy',error:'Another response is in progress.'}});return}
      this.save({...this.state.draft,submission:{id,text,references:submission.references,kind:'pending'}});
      await this.refresh();
    }catch(e){
      if(this.state.selected!==botId||this.state.sessionId!==sessionId||this.state.draft.submission?.id!==id)return;
      const rejected=!uncertain&&e instanceof ApiError&&e.status>=400&&e.status<500&&e.status!==401;
      this.save({...this.state.draft,submission:{id,text,references:submission.references,kind:rejected?'rejected':'unknown',error:String(e)}});
    }
  }
  dismissSubmission(){const submission=this.state.draft.submission;if(submission&&['busy','rejected','failed','interrupted'].includes(submission.kind))this.save({...this.state.draft,submission:null})}
  async checkSubmission(){
    const botId=this.state.selected,sessionId=this.state.sessionId,submission=this.state.draft.submission;
    if(!submission||!botId||!sessionId||this.checking)return;
    this.checking=true;
    try{
      const command=await this.api<{state:string;error:string|null}>('/api/commands/'+submission.id);
      if(this.state.selected!==botId||this.state.sessionId!==sessionId||this.state.draft.submission?.id!==submission.id)return;
      const {id,text}=submission;
      if(command.state==='completed'||command.state==='stopped'){this.save({...this.state.draft,submission:null});void this.refresh()}
      else if(command.state==='failed'||command.state==='interrupted')this.save({...this.state.draft,submission:{id,text,references:submission.references,kind:command.state,error:command.error}});
      else this.save({...this.state.draft,submission:{id,text,references:submission.references,kind:'pending'}});
    }catch(e){
      if(this.state.selected!==botId||this.state.sessionId!==sessionId||this.state.draft.submission?.id!==submission.id)return;
      if(e instanceof ApiError&&e.status===404){if(submission.kind!=='uncertain-busy')await this.submit(botId,sessionId,submission);return}
      if(submission.kind!=='uncertain-busy')this.save({...this.state.draft,submission:{id:submission.id,text:submission.text,references:submission.references,kind:'unknown',error:String(e)}});
    }finally{this.checking=false}
  }
  async checkEarlierSubmission(key:string) {
    const identity=this.earlierDraftIdentity(key);if(!identity)throw Error('The record has no verifiable draft identity');
    const raw=localStorage.getItem(key);const value:unknown=raw?JSON.parse(raw):null;
    if(!isRecord(value)||!isRecord(value.submission)||typeof value.submission.id!=='string'||typeof value.submission.text!=='string')throw Error('No saved submission');
    const command=await this.api<{botId:string;sessionId:string;content:string;state:string;error:string|null}>('/api/commands/'+encodeURIComponent(value.submission.id));
    if(command.botId!==identity.botId||(identity.sessionId!==null&&command.sessionId!==identity.sessionId)||command.content!==value.submission.text)throw Error('Saved submission does not match the original command');
    return command;
  }
  async inspectReference(botId:string,reference:WorkspaceReference) {
    return parseResolvedReference(await this.api<unknown>('/api/bots/'+encodeURIComponent(botId)+'/references/preview',{reference,inspect:true}));
  }
  async addReference(reference:WorkspaceReference) {
    const botId=this.state.selected,sessionId=this.state.sessionId,key=this.currentKey;
    if(!botId||!sessionId||!this.state.draftReady)throw Error('Wait for the current draft to load.');
    const resolved=parseResolvedReference(await this.api<unknown>('/api/bots/'+encodeURIComponent(botId)+'/references/preview',{reference}));
    if(this.state.selected!==botId||this.state.sessionId!==sessionId||this.currentKey!==key)throw Error('The conversation changed. Select the source again.');
    const sources=this.state.draft.references??[];
    if(sources.some(source=>JSON.stringify(source.reference)===JSON.stringify(resolved.reference)))return;
    if(sources.length>=8)throw Error('Select at most eight source references.');
    this.save({...this.state.draft,references:[...sources,{reference:resolved.reference,title:resolved.title,location:resolved.location}]});
  }
  removeReference(index:number) {this.save({...this.state.draft,references:(this.state.draft.references??[]).filter((_,i)=>i!==index)});}
  async sessionList(botId:string,offset=0) {return this.api<{current:{id:string;name:string};sessions:Array<{id:string;name:string;createdAt:number;active:number}>}>('/api/bots/'+encodeURIComponent(botId)+'/sessions?offset='+offset);}
  async sessionRead(botId:string,sessionId:string,offset=0) {return this.api<{messages:Message[]}>('/api/bots/'+encodeURIComponent(botId)+'/sessions/'+encodeURIComponent(sessionId)+'?offset='+offset);}
  async sessionSearch(botId:string,query:string) {return this.api<Array<{sessionId:string;messageId:string;role:string;content:string;start:number}>>('/api/bots/'+encodeURIComponent(botId)+'/session-search?q='+encodeURIComponent(query));}
  async startSession(botId:string,name:string) {
    const sessionId=this.state.sessionId,dataset=this.dataset;if(!sessionId||!dataset||this.state.selected!==botId)throw Error('Current session unavailable');
    const journal=prefix+'session-create:'+dataset+':'+botId+':';
    const pending=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).find(key=>key?.startsWith(journal));
    const key=pending ?? journal+sessionId;
    if(!await this.claim(key))throw Error('Session creation is in use in another tab');
    if(this.dataset!==dataset||this.state.selected!==botId)throw Error('Dataset or agent changed');
    let operation=localStorage.getItem(key);if(!operation){operation=JSON.stringify({operationId:crypto.randomUUID(),expectedSessionId:sessionId,name});localStorage.setItem(key,operation);}
    try {
      const result=await this.api('/api/bots/'+encodeURIComponent(botId)+'/sessions',JSON.parse(operation));
      localStorage.removeItem(key);await this.refresh();return result;
    }catch(error){
      if(error instanceof ApiError && error.status===409 && error.message==='Active session changed') {localStorage.removeItem(key);await this.refresh();throw Error('Another client started a session. Review it before starting another.');}
      throw error;
    }
  }
  openSetup(){this.update({setup:this.retainedCreation??{kind:'create',name:'',instructions:'',provider:'',model:'',operationId:null,status:''}})}
  async setupProvider(provider:string){const setup=this.state.setup;if(setup.kind!=='create'||setup.operationId)return;this.update({setup:{...setup,provider,model:'',reasoning:'default'}});try{const defaults=await this.providerDefaults();const pair=defaults.providers[provider];const current=this.state.setup;if(current.kind==='create'&&!current.operationId&&current.provider===provider&&!current.model)this.update({setup:{...current,model:pair?.model??'',reasoning:pair?.reasoning??'default'}})}catch{/* Creation remains possible while defaults are unavailable. */}}
  setupField(field:'name'|'instructions'|'provider'|'model'|'reasoning',value:string){const setup=this.state.setup;if(setup.kind==='create'&&!setup.operationId)this.update({setup:{...setup,[field]:value}})}
  closeSetup(){if(this.state.setup.kind==='create'&&this.state.setup.operationId)this.retainedCreation=this.state.setup;this.update({setup:{kind:'closed'}})}
  async create(retry=false){const dataset=this.dataset;let s=this.state.setup;if(!dataset||s.kind!=='create')return;if(!s.name.trim()){this.update({setup:{...s,status:'Enter a name for your agent.'}});return;}if(!s.operationId)s={...s,operationId:crypto.randomUUID()};const key=prefix+'creation:'+dataset+':'+s.operationId;this.update({setup:s});try{if(!await this.claim(key))throw Error('Creation is in use');if(this.dataset!==dataset)return;localStorage.setItem(key,JSON.stringify(s));this.retainedCreation=s}catch{this.update({setup:{...s,status:'Browser storage unavailable. Creation is blocked.'}});return}this.update({setup:{...s,status:retry?'Retrying the same operation.':'Creating…'}});try{const provider=s.provider===undefined?'codex':s.provider;const bot=await this.api<Bot>('/api/bots',{operationId:s.operationId,name:s.name,instructions:s.instructions,...(provider?{provider}:{}),...(s.model.trim()?{model:s.model.trim()}:{}),...(s.reasoning?{reasoning:s.reasoning}:{})});if(this.dataset!==dataset)return;localStorage.removeItem(key);this.retainedCreation=null;this.update({setup:{kind:'closed'},selected:bot.id,notice:'Agent created. Provider readiness has not been verified.'});sessionStorage.setItem('staf-selected-agent',bot.id);await this.refresh()}catch(e){if(this.dataset!==dataset)return;this.update({setup:{...s,status:'Result may be uncertain. Your form is retained. Check status or retry the same operation. '+String(e)}})}}
  async checkCreate(){const dataset=this.dataset;const s=this.state.setup;if(!dataset||s.kind!=='create'||!s.operationId)return;try{const bot=await this.api<Bot>('/api/bot-creations/'+s.operationId);if(this.dataset!==dataset)return;localStorage.removeItem(prefix+'creation:'+dataset+':'+s.operationId);this.retainedCreation=null;this.update({setup:{kind:'closed'},selected:bot.id,notice:'Recovered the created agent.'});sessionStorage.setItem('staf-selected-agent',bot.id);await this.refresh()}catch(e){if(this.dataset!==dataset)return;this.update({setup:{...s,status:'Status unavailable. A missing record does not prove an in-flight request cannot finish. '+String(e)}})}}
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
  async providerDefaults(){return parseProviderDefaults(await this.api<unknown>('/api/provider-defaults'))}
  async saveProviderDefault(revision:string,provider:string,model:string,reasoning:string){return parseProviderDefaults(await this.api<unknown>('/api/provider-defaults',{revision,provider,model:model.trim()||null,reasoning:reasoning==='default'?null:reasoning}))}
  async models(provider:string){return parseModelCatalog(await this.api<unknown>('/api/models',{provider}))}
  async selectProvider(profile:BotProfile,provider:string,edit:{model?:string|null;reasoning?:string|null}={}){const result=parseSelection(await this.api<unknown>('/api/bots/'+profile.id+'/selection',{revision:profile.revision,provider,...edit}));await this.refresh();return result}
  async botProfile(id:string){return this.api<BotProfile>('/api/bots/'+id)}
  async documents(botId:string,signal?:AbortSignal,offset=0) {return this.api<DocumentSummary[]>('/api/bots/'+encodeURIComponent(botId)+'/documents'+(offset?'/pages/'+offset:''),undefined,signal);}
  async uploadDocument(botId:string,operationId:string,file:File,signal?:AbortSignal) {const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length>10*1024*1024)throw Error('Document exceeds 10 MiB');let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return this.api<DocumentSummary>('/api/bots/'+encodeURIComponent(botId)+'/documents',{operationId,name:file.name,base64:btoa(binary)},signal);}
  async searchDocuments(botId:string,query:string,signal?:AbortSignal) {return this.api<DocumentExcerpt[]>('/api/bots/'+encodeURIComponent(botId)+'/documents/search',{query},signal);}
  async readDocument(botId:string,id:string,signal?:AbortSignal,offset=0) {return this.api<{document:DocumentSummary;excerpts:DocumentExcerpt[]}>('/api/bots/'+encodeURIComponent(botId)+'/documents/'+encodeURIComponent(id)+(offset?'/excerpts/'+offset:''),undefined,signal);}
  async retireDocument(botId:string,id:string) {return this.api<DocumentSummary>('/api/bots/'+encodeURIComponent(botId)+'/documents/'+encodeURIComponent(id)+'/retire',{});}
  async downloadDocument(botId:string,id:string,name:string) {const dataset=this.dataset;if(!dataset)throw Error('Dataset identity unavailable');const response=await fetch('/api/bots/'+encodeURIComponent(botId)+'/documents/'+encodeURIComponent(id)+'/original',{headers:{Authorization:'Bearer '+this.token,'X-Staf-Dataset':dataset}});if(!response.ok || response.headers.get('X-Staf-Dataset')!==dataset || this.dataset!==dataset)throw Error('Could not download document');const blob=await response.blob();const url=URL.createObjectURL(blob);try{const link=document.createElement('a');link.href=url;link.download=name;link.click();}finally{URL.revokeObjectURL(url);}}
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
  async artifactList(botId:string) {return this.api<ArtifactSummary[]>('/api/bots/'+encodeURIComponent(botId)+'/artifacts');}
  async artifactRevisions(botId:string,id:string) {return this.api<ArtifactRevisionInfo[]>('/api/bots/'+encodeURIComponent(botId)+'/artifacts/'+encodeURIComponent(id)+'/revisions');}
  async artifactRead(botId:string,id:string,revision:number) {return this.api<ArtifactRevision>('/api/bots/'+encodeURIComponent(botId)+'/artifacts/'+encodeURIComponent(id)+'/revisions/'+revision);}
  async artifactCreate(botId:string,input:ArtifactCreateInput) {return this.api<ArtifactRevision>('/api/bots/'+encodeURIComponent(botId)+'/artifacts',input);}
  async artifactRevise(botId:string,id:string,input:{operationId:string;expectedRevision:number;content:string}) {return this.api<ArtifactRevision>('/api/bots/'+encodeURIComponent(botId)+'/artifacts/'+encodeURIComponent(id)+'/revisions',input);}
  async artifactDownload(botId:string,id:string,revision:number) {
    const dataset=this.dataset,token=this.token;if(!dataset || !token)throw Error('Access unavailable');
    const response=await fetch('/api/bots/'+encodeURIComponent(botId)+'/artifacts/'+encodeURIComponent(id)+'/revisions/'+revision+'/download',{headers:{Authorization:'Bearer '+token,'X-Staf-Dataset':dataset}});
    if(!response.ok || response.headers.get('X-Staf-Dataset')!==dataset || this.dataset!==dataset || this.token!==token)throw Error('Download failed or access changed');
    return response.blob();
  }
  async saveBotProfile(profile:BotProfile,edit:{name:string;provider:string;model:string;instructions:string}){await this.api('/api/bots/'+profile.id+'/profile',{revision:profile.revision,name:edit.name,description:profile.description,instructions:edit.instructions,provider:edit.provider,model:edit.model.trim()||null,reasoning:profile.reasoning});await this.refresh()}
  async setArchived(profile:BotProfile,archived:boolean){await this.api('/api/bots/'+profile.id+'/'+(archived?'archive':'restore'),{revision:profile.revision});await this.refresh()}
  async decide(item:Extract<InboxItem,{kind:'approval'}>,decision:'approve'|'deny'){const route={clock:'approvals',web:'web-approvals',search:'search-approvals',shell:'shell-approvals',disclosure:'disclosures'}[item.approvalKind];try{await this.api('/api/'+route+'/'+item.id+'/'+decision,{});this.update({notice:'Decision recorded.'});await this.refresh()}catch(e){this.update({actionError:'Decision failed or is uncertain. Refresh before trying again.'});this.notify('Decision failed or is uncertain. Refresh before trying again.','error');await this.refresh()}}
}
