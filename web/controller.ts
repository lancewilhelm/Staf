import type {ToastNotice} from './toasts';
import {responseEvents} from './response-stream';

export type ModelCatalog={models:Array<{id:string;label:string;reasoning:string[]|null;reasoningStatus:string}>;defaultModel?:string};
export type Bot={revision?:string;id:string;name:string;provider:string;model:string|null;archived:boolean};
export type BotProfile=Bot & {revision:string;instructions:string;description:string;reasoning:string|null;configDir:string;providerChoices?:Record<string,{model:string|null;reasoning:string|null}>};
export type Message={id:string;role:string;content:string};
export type ResponseProgress={id:string;botId:string;state:'accepted'|'running'|'stopping'|'stopped'|'completed'|'failed'|'interrupted';text:string;error:string|null};
export type ChatWork={id:string;progress:ResponseProgress;events:Array<{id:number;type:string;name:string;success:number|null;detail:string|null}>};
export type Task={id:string;objective:string;state:string;outcome:string|null;activity?:Array<Record<string,unknown>>};
export type InboxItem={kind:'question';id:string;botId:string|null;attemptId:string;text:string}|{kind:'approval';approvalKind:'clock'|'web'|'search'|'shell'|'disclosure';id:string;botId:string|null;work:{kind:'task'|'command';id:string};detail:unknown};
type SubmissionIdentity={id:string;text:string};
export type Submission=SubmissionIdentity & (
  | {kind:'submitting'|'submitting-uncertain'|'pending'}
  | {kind:'unknown'|'uncertain-busy'|'busy'|'rejected';error:string}
  | {kind:'failed'|'interrupted';error:string|null}
);
export type Draft={text:string;submission:Submission|null};
export type Connection={kind:'connecting'}|{kind:'pairing';message:string}|{kind:'ready'}|{kind:'offline';message:string};
export type Setup={kind:'closed'}|{kind:'create';name:string;instructions:string;provider:string;model:string;reasoning?:string;operationId:string|null;status:string};
export type Workspace={connection:Connection;setup:Setup;bots:Bot[];selected:string|null;messages:Message[];work:ChatWork[];response:ResponseProgress|null;responseConnection:'connecting'|'connected'|'reconnecting';inbox:InboxItem[];credential:'signed-in'|'signed-out'|'unknown';openrouter:'saved'|'missing'|'unknown'|'error';authAttempt:{id:string;phase:string}|null;authUrl:string;authUrlAttemptId:string;freshness:string;notice:string;notices:ToastNotice[];authStarting:boolean;authStatus:string;actionError:string;draft:Draft;draftReady:boolean};
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

function isResponseProgress(value:unknown,botId:string):value is ResponseProgress {
  return isRecord(value)&&typeof value.id==='string'&&value.botId===botId&&typeof value.state==='string'&&['accepted','running','stopping','stopped','completed','failed','interrupted'].includes(value.state)&&typeof value.text==='string'&&(value.error===null||typeof value.error==='string');
}
const prefix='staf-workspace-v1:';
function normalizeDraft(draft:Draft):Draft {
  const submission=draft.submission;
  if(submission?.kind==='submitting'||submission?.kind==='submitting-uncertain')return {...draft,submission:{id:submission.id,text:submission.text,kind:'unknown',error:'Recovering the original request.'}};
  if(submission && submission.kind==='busy' && 'uncertain' in submission && submission.uncertain===true)return {...draft,submission:{id:submission.id,text:submission.text,kind:'uncertain-busy',error:'Another response is in progress. The original request may still arrive.'}};
  return draft;
}
export class Controller {
  private writer=crypto.randomUUID(); private checking=false; private listeners=new Set<()=>void>(); private generation=0; private seen=new Set<string>(); private token=localStorage.getItem('staf-token')||''; private currentKey=''; private timer:number; private responseStream:{botId:string;controller:AbortController}|null=null;
  state:Workspace={connection:{kind:'connecting'},setup:{kind:'closed'},bots:[],selected:null,messages:[],work:[],response:null,responseConnection:'connecting',inbox:[],credential:'unknown',openrouter:'unknown',authAttempt:null,authUrl:'',authUrlAttemptId:'',freshness:'',notice:'',notices:[],authStarting:false,authStatus:'',actionError:'',draft:{text:'',submission:null},draftReady:false};
  constructor(){this.timer=window.setInterval(()=>{if(document.visibilityState==='visible')void this.refresh()},1000);window.addEventListener('online',()=>void this.refresh());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void this.refresh()});void this.restoreCreation();void this.removeObsoleteRecords();void this.refresh()}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn)};
  snapshot=()=>this.state;
  notify(message:string,kind:ToastNotice['kind']='info',topic?:string){this.update({notices:[...this.state.notices.filter(n=>!topic||n.topic!==topic),{id:crypto.randomUUID(),message,kind,...(topic?{topic}:{})}]})}
  dismissNotice=(id:string)=>{this.update({notices:this.state.notices.filter(n=>n.id!==id)})};
  private update(change:Partial<Workspace>){
    if(change.notice){change.notices=[...this.state.notices,{id:crypto.randomUUID(),message:change.notice,kind:'info'}]}
    this.state={...this.state,...change};this.listeners.forEach(fn=>fn())}
  private async api<T>(path:string,body?:unknown):Promise<T>{const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(this.token?{Authorization:'Bearer '+this.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data:unknown=await response.json();if(!response.ok){const message=typeof data==='object'&&data!==null&&'error'in data&&typeof data.error==='string'?data.error:'Request failed';throw new ApiError(message,response.status)}return data as T}
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
  async pair(code:string){try{const result=await this.api<{token:string}>('/api/pair',{code});localStorage.setItem('staf-token',result.token);this.token=result.token;await this.refresh()}catch(e){this.update({connection:{kind:'pairing',message:String(e)}})}}
  async refresh(){if(!this.token){this.update({connection:{kind:'pairing',message:''}});return}const gen=++this.generation;try{const [bots,allInbox,credential,current,openrouter]=await Promise.all([this.api<Bot[]>('/api/bots'),this.api<InboxItem[]>('/api/inbox'),this.api<{signedIn:boolean}>('/api/codex-auth/credential'),this.api<{attempt:{id:string;phase:string}|null}>('/api/codex-auth/current'),this.api<{saved:boolean}>('/api/openrouter-connection').catch(()=>({saved:null}))]);const inbox=allInbox.filter(item=>item.kind==='approval'&&item.work.kind==='command');const preferred=this.state.selected||sessionStorage.getItem('staf-selected-agent');const selected=preferred && bots.some(b=>b.id===preferred&&!b.archived)?preferred:bots.find(b=>!b.archived)?.id??null;const chat=selected?await this.api<{messages:Message[];requests:ChatWork[]}>('/api/bots/'+selected+'/chat-work'):{messages:[],requests:[]};const {messages,requests:work}=chat;if(gen!==this.generation)return;const changed=selected!==this.state.selected;if(changed){await this.loadDraft(selected,gen);if(gen!==this.generation)return;}this.reconcileAuth(current.attempt);this.update({connection:{kind:'ready'},bots,selected,messages,...(changed?{response:null}:{}),work,inbox,credential:credential.signedIn?'signed-in':'signed-out',openrouter:openrouter.saved===null?'error':openrouter.saved?'saved':'missing',authAttempt:current.attempt,freshness:''});this.watchResponse(selected);if(this.state.draft.submission && (['pending','unknown'].includes(this.state.draft.submission.kind)||this.state.draft.submission.kind==='uncertain-busy'))void this.checkSubmission()}catch(e){if(gen!==this.generation)return;if(e instanceof ApiError&&e.status===401){this.token='';this.watchResponse(null);localStorage.removeItem('staf-token');this.update({connection:{kind:'pairing',message:'Pairing expired or was revoked.'}})}else this.update({connection:{kind:'offline',message:'Connection unavailable. Showing the last successful update.'},freshness:String(e)})}}
  async select(id:string){
    if(id===this.state.selected)return;
    sessionStorage.setItem('staf-selected-agent',id);this.generation++;
    this.currentKey='';this.update({selected:id,messages:[],work:[],response:null,draft:{text:'',submission:null},draftReady:false});
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
        const own=prefix+this.writer+':'+id;
        const candidates=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>!!key && key.startsWith(prefix) && key.endsWith(':'+id) && !key.includes(':creation:'));
        const ordered=[...candidates.filter(key=>this.claims.has(key)),...candidates.filter(key=>!this.claims.has(key))];
        let key=own;
        for(const candidate of ordered){
          const saved=localStorage.getItem(candidate);if(!saved)continue;
          const parsed:unknown=JSON.parse(saved);
          if(!isRecord(parsed)||typeof parsed.text!=='string'||(!parsed.text && !parsed.submission))continue;
          if(await this.claim(candidate)){key=candidate;break;}
        }
        if(!await this.claim(key))throw Error('Draft is in use');
        if(load!==this.draftLoad || (expectedGeneration!==undefined && expectedGeneration!==this.generation))return;
        this.currentKey=key;
        const saved=localStorage.getItem(key);
        if(saved)draft=normalizeDraft(JSON.parse(saved));
      }
    }catch{if(load===this.draftLoad && (expectedGeneration===undefined || expectedGeneration===this.generation)){this.currentKey='';this.update({actionError:'Browser storage or locking is unavailable. Sending is blocked.'});this.notify('Browser storage or locking is unavailable. Sending is blocked.','error')}}
    if(load===this.draftLoad && (expectedGeneration===undefined || expectedGeneration===this.generation))this.update({draft,draftReady:!!this.currentKey});
  }
  private async recoverNext(){
    const id=this.state.selected,current=this.currentKey;
    if(this.recovering||!id||!current||this.state.draft.text||this.state.draft.submission)return;
    this.recovering=true;
    try{
      const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>!!key&&key!==current&&key.startsWith(prefix)&&key.endsWith(':'+id)&&!key.includes(':creation:'));
      for(const key of keys){
        const saved=localStorage.getItem(key);if(!saved)continue;
        const candidate:Draft=JSON.parse(saved);if(typeof candidate.text!=='string'||(!candidate.text&&!candidate.submission))continue;
        if(!await this.claim(key))continue;
        if(this.currentKey!==current||this.state.selected!==id||this.state.draft.text||this.state.draft.submission)return;
        const latest=localStorage.getItem(key);if(!latest)continue;
        const draft=normalizeDraft(JSON.parse(latest));if(typeof draft.text!=='string'||(!draft.text&&!draft.submission))continue;
        this.currentKey=key;this.update({draft});void this.refresh();return;
      }
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
  private async restoreCreation(){
    try{
      const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>!!key&&key.startsWith(prefix+'creation:'));
      for(const key of keys){
        if(!await this.claim(key))continue;
        const value=localStorage.getItem(key);if(!value)continue;
        const saved:unknown=JSON.parse(value);
        if(!isRecord(saved)||saved.kind!=='create'||typeof saved.operationId!=='string'||key!==prefix+'creation:'+saved.operationId||typeof saved.name!=='string'||typeof saved.instructions!=='string'||typeof saved.provider!=='string'||typeof saved.model!=='string'||(saved.reasoning!==undefined&&(typeof saved.reasoning!=='string'||!['default','none','minimal','low','medium','high','xhigh','max'].includes(saved.reasoning))))continue;
        const setup:Extract<Setup,{kind:'create'}>={kind:'create',operationId:saved.operationId,name:saved.name,instructions:saved.instructions,provider:saved.provider,model:saved.model,...(saved.reasoning===undefined?{}:{reasoning:saved.reasoning}),status:'Recovered creation. Check status or retry the same operation.'};
        if(this.state.setup.kind!=='closed'||this.retainedCreation)return;
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
    const setupError=bot?.provider==='codex'&&this.state.credential==='signed-out'?'Connect Codex in Settings to send.':bot?.provider==='openrouter'&&this.state.openrouter!=='saved'?'Connect OpenRouter in Settings to send.':bot&&bot.provider!=='demo'&&!bot.model?.trim()?'Choose a model for this agent to send.':null;
    if(setupError){this.save({...this.state.draft,submission:{id:current.id,text:current.text,kind:uncertain?'unknown':'rejected',error:setupError}});return}
    await this.submit(botId,current);
  }
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
      if(command.state==='completed'||command.state==='stopped'){this.save({...this.state.draft,submission:null});void this.refresh()}
      else if(command.state==='failed'||command.state==='interrupted')this.save({...this.state.draft,submission:{id,text,kind:command.state,error:command.error}});
      else this.save({...this.state.draft,submission:{id,text,kind:'pending'}});
    }catch(e){
      if(this.state.selected!==botId||this.state.draft.submission?.id!==submission.id)return;
      if(e instanceof ApiError&&e.status===404){if(submission.kind!=='uncertain-busy')await this.submit(botId,submission);return}
      if(submission.kind!=='uncertain-busy')this.save({...this.state.draft,submission:{id:submission.id,text:submission.text,kind:'unknown',error:String(e)}});
    }finally{this.checking=false}
  }
  openSetup(){this.update({setup:this.retainedCreation??{kind:'create',name:'',instructions:'',provider:'',model:'',operationId:null,status:''}})}
  async setupProvider(provider:string){const setup=this.state.setup;if(setup.kind!=='create'||setup.operationId)return;this.update({setup:{...setup,provider,model:'',reasoning:'default'}});try{const defaults=await this.providerDefaults();const pair=defaults.providers[provider];const current=this.state.setup;if(current.kind==='create'&&!current.operationId&&current.provider===provider&&!current.model)this.update({setup:{...current,model:pair?.model??'',reasoning:pair?.reasoning??'default'}})}catch{/* Creation remains possible while defaults are unavailable. */}}
  setupField(field:'name'|'instructions'|'provider'|'model'|'reasoning',value:string){const setup=this.state.setup;if(setup.kind==='create'&&!setup.operationId)this.update({setup:{...setup,[field]:value}})}
  closeSetup(){if(this.state.setup.kind==='create'&&this.state.setup.operationId)this.retainedCreation=this.state.setup;this.update({setup:{kind:'closed'}})}
  async create(retry=false){let s=this.state.setup;if(s.kind!=='create')return;if(!s.name.trim()){this.update({setup:{...s,status:'Enter a name for your agent.'}});return;}if(!s.operationId)s={...s,operationId:crypto.randomUUID()};const key=prefix+'creation:'+s.operationId;this.update({setup:s});try{if(!await this.claim(key))throw Error('Creation is in use');localStorage.setItem(key,JSON.stringify(s));this.retainedCreation=s}catch{this.update({setup:{...s,status:'Browser storage unavailable. Creation is blocked.'}});return}this.update({setup:{...s,status:retry?'Retrying the same operation.':'Creating…'}});try{const provider=s.provider===undefined?'codex':s.provider;const bot=await this.api<Bot>('/api/bots',{operationId:s.operationId,name:s.name,instructions:s.instructions,...(provider?{provider}:{}),...(s.model.trim()?{model:s.model.trim()}:{}),...(s.reasoning?{reasoning:s.reasoning}:{})});localStorage.removeItem(key);this.retainedCreation=null;this.update({setup:{kind:'closed'},selected:bot.id,notice:'Agent created. Provider readiness has not been verified.'});sessionStorage.setItem('staf-selected-agent',bot.id);await this.loadDraft(bot.id);await this.refresh()}catch(e){this.update({setup:{...s,status:'Result may be uncertain. Your form is retained. Check status or retry the same operation. '+String(e)}})}}
  async checkCreate(){const s=this.state.setup;if(s.kind!=='create'||!s.operationId)return;try{const bot=await this.api<Bot>('/api/bot-creations/'+s.operationId);localStorage.removeItem(prefix+'creation:'+s.operationId);this.retainedCreation=null;this.update({setup:{kind:'closed'},selected:bot.id,notice:'Recovered the created agent.'});sessionStorage.setItem('staf-selected-agent',bot.id);await this.loadDraft(bot.id);await this.refresh()}catch(e){this.update({setup:{...s,status:'Status unavailable. A missing record does not prove an in-flight request cannot finish. '+String(e)}})}}
  async saveOpenRouter(key:string){await this.api('/api/openrouter-connection',{key});await this.refresh()}
  async disconnectOpenRouter(){await this.api('/api/openrouter-connection/disconnect',{});await this.refresh()}
  private reconcileAuth(attempt:Workspace['authAttempt']){
    const previous=this.state.authAttempt;
    if(attempt?.id===previous?.id&&attempt?.phase===previous?.phase)return;
    this.update({notices:this.state.notices.filter(n=>n.topic!=='auth'),authStatus:'',...(attempt?.phase==='waiting'&&attempt.id===this.state.authUrlAttemptId?{}:{authUrl:'',authUrlAttemptId:''})});
    if(!attempt)return;
    if(attempt.phase==='succeeded')this.notify('Codex sign-in saved. Account and model access have not been verified.','success','auth');
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
  async signOutAuth(){try{await this.api('/api/codex-auth/logout',{});this.update({authUrl:'',authUrlAttemptId:'',authStatus:'',notices:this.state.notices.filter(n=>n.topic!=='auth')});await this.refresh();this.notify('Codex sign-in removed from this instance.','success','auth')}catch(e){this.update({authStatus:'Could not sign out. Check connection and retry.'});this.notify('Could not sign out. Check connection and retry.','error','auth')}}
  async providerDefaults(){return parseProviderDefaults(await this.api<unknown>('/api/provider-defaults'))}
  async saveProviderDefault(revision:string,provider:string,model:string,reasoning:string){return parseProviderDefaults(await this.api<unknown>('/api/provider-defaults',{revision,provider,model:model.trim()||null,reasoning:reasoning==='default'?null:reasoning}))}
  async models(provider:string){return parseModelCatalog(await this.api<unknown>('/api/models',{provider}))}
  async selectProvider(profile:BotProfile,provider:string,edit:{model?:string|null;reasoning?:string|null}={}){const result=parseSelection(await this.api<unknown>('/api/bots/'+profile.id+'/selection',{revision:profile.revision,provider,...edit}));await this.refresh();return result}
  async botProfile(id:string){return this.api<BotProfile>('/api/bots/'+id)}
  async saveBotProfile(profile:BotProfile,edit:{name:string;provider:string;model:string;instructions:string}){await this.api('/api/bots/'+profile.id+'/profile',{revision:profile.revision,name:edit.name,description:profile.description,instructions:edit.instructions,provider:edit.provider,model:edit.model.trim()||null,reasoning:profile.reasoning});await this.refresh()}
  async setArchived(profile:BotProfile,archived:boolean){await this.api('/api/bots/'+profile.id+'/'+(archived?'archive':'restore'),{revision:profile.revision});await this.refresh()}
  async decide(item:Extract<InboxItem,{kind:'approval'}>,decision:'approve'|'deny'){const route={clock:'approvals',web:'web-approvals',search:'search-approvals',shell:'shell-approvals',disclosure:'disclosures'}[item.approvalKind];try{await this.api('/api/'+route+'/'+item.id+'/'+decision,{});this.update({notice:'Decision recorded.'});await this.refresh()}catch(e){this.update({actionError:'Decision failed or is uncertain. Refresh before trying again.'});this.notify('Decision failed or is uncertain. Refresh before trying again.','error');await this.refresh()}}
}
