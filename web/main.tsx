import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import Markdown from 'react-markdown';
import {Controller,type BotProfile,type InboxItem} from './controller';
import './style.css';

const app=new Controller();

function CodeBlock({children}:{children:ReactNode}){
  const ref=useRef<HTMLPreElement>(null);
  const [status,setStatus]=useState('Copy');
  return <div className="code-block"><button className="quiet" onClick={()=>{void navigator.clipboard.writeText(ref.current?.querySelector('code')?.textContent??'').then(()=>setStatus('Copied'),()=>setStatus('Copy failed'))}}>{status}</button><pre ref={ref}>{children}</pre></div>;
}
function ResponseText({text}:{text:string}){return <div className="bottext markdown"><Markdown skipHtml components={{pre:({children})=><CodeBlock>{children}</CodeBlock>,a:({href,children})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>}}>{text}</Markdown></div>}

type View='chat'|'inbox'|'settings'|'bot';
type Appearance='light'|'dark'|'system';
const appearanceKey='staf-appearance';
function readAppearance():Appearance{
  try{const saved=localStorage.getItem(appearanceKey);return saved==='light'||saved==='dark'?saved:'system'}catch{return 'system'}
}
function applyAppearance(appearance:Appearance){document.documentElement.dataset.appearance=appearance}
const initialAppearance=readAppearance();
applyAppearance(initialAppearance);

function Item({item}:{item:InboxItem}){
  return <article className="item">
    <strong>{item.kind==='question'?'Owner input needed':item.approvalKind+' approval'}</strong>
    {item.kind==='question'?<>
      <p>{item.text}</p>
      <p className="meta">Task {item.attemptId} · Question {item.id}</p>
      <p className="meta">Replying to task questions in the workspace is not available yet.</p>
    </>:<>
      <p className="meta">{item.work.kind} {item.work.id}</p>
      <p>{item.approvalKind==='shell'?'Commands, output, and unknown secrets may be retained in chat, Activity, and backups. The Docker daemon and image must be trusted.':item.approvalKind==='search'?'The configured search backend may retain and forward this exact query. Queries and results may be retained in chat, Activity, and backups.':item.approvalKind==='web'?'This allows the exact public URL shown. Each redirect requires a separate approval. URLs and source text may be retained in chat, Activity, and backups.':item.approvalKind==='disclosure'?'Review the exact sender, recipient, and message before allowing disclosure.':'This allows one UTC clock read.'}</p>
      <pre>{typeof item.detail==='string'?item.detail:JSON.stringify(item.detail,null,2)}</pre>
      <div className="row"><button onClick={()=>void app.decide(item,'approve')}>Approve once</button><button className="quiet" onClick={()=>void app.decide(item,'deny')}>Deny</button></div>
    </>}
  </article>;
}

function BotModelSettings({id,onClose,saving,setSaving}:{id:string;onClose:()=>void;saving:boolean;setSaving:(saving:boolean)=>void}){
  const [profile,setProfile]=useState<BotProfile|null>(null);
  const [name,setName]=useState('');
  const [provider,setProvider]=useState('');
  const [model,setModel]=useState('');
  const [instructions,setInstructions]=useState('');
  const [status,setStatus]=useState('');
  const [compareAvailable,setCompareAvailable]=useState(false);
  const [latest,setLatest]=useState<BotProfile|null>(null);
  useEffect(()=>{let active=true;void app.botProfile(id).then(p=>{if(active){setProfile(p);setName(p.name);setProvider(p.provider);setModel(p.model||'');setInstructions(p.instructions)}}).catch(e=>{if(active)setStatus('Could not load agent settings. '+String(e))});return()=>{active=false}},[id]);
  async function save(){
    if(!profile)return;
    if(!name.trim()){setStatus('Enter a name for this agent.');return}
    if(provider!==profile.provider&&!window.confirm('Changing the provider may send this conversation history to the new provider. Continue?'))return;
    setSaving(true);setStatus('');setLatest(null);
    try{await app.saveBotProfile(profile,{name,provider,model,instructions});onClose()}catch(e){setCompareAvailable(true);setStatus('The save failed or its result is uncertain. Your edits are retained. Compare the current settings before retrying. '+String(e))}finally{setSaving(false)}
  }
  async function compare(){
    setSaving(true);
    try{const current=await app.botProfile(id);setProfile(current);setLatest(current);setCompareAvailable(false);setStatus('Review the current settings below and reconcile your edits before saving. A later change will still cause a conflict.')}
    catch(e){setStatus('Could not load the current settings. Your edits are retained. '+String(e))}
    finally{setSaving(false)}
  }
  async function archive(){
    if(!profile || !window.confirm('Archive this agent? Its configuration and conversation will be retained.'))return;
    setSaving(true);setStatus('');
    try{await app.setArchived(profile,true);onClose()}catch(e){setCompareAvailable(true);setStatus('Could not archive the agent, or the result is uncertain. Compare the current settings before retrying. '+String(e))}finally{setSaving(false)}
  }
  return <div className="setup"><span className="eyebrow">AGENT SETTINGS</span><h2>{profile?.name||'Agent settings'}</h2>
    {profile&&<><p>Provider connections are shared by the instance.</p><label>Name<input disabled={saving} value={name} onChange={e=>setName(e.target.value)}/></label><label>Provider<select disabled={saving} value={provider} onChange={e=>setProvider(e.target.value)}><option value="demo">Demo</option><option value="codex">Codex</option><option value="openrouter">OpenRouter</option><option value="lmstudio">LM Studio</option><option value="live">HTTP compatible</option></select></label><label>Model<input disabled={saving} value={model} onChange={e=>setModel(e.target.value)}/></label><label>Instructions<textarea disabled={saving} value={instructions} onChange={e=>setInstructions(e.target.value)}/></label><p className="meta">Configuration: <code>{profile.configDir}</code></p><div className="row"><button disabled={saving} onClick={()=>void save()}>Save settings</button><button disabled={saving} className="quiet" onClick={onClose}>Cancel</button></div></>}
    {profile&&!profile.archived&&<button disabled={saving} className="quiet" onClick={()=>void archive()}>Archive agent</button>}
    <p role="status">{saving?'Loading or saving…':status}</p>
    {compareAvailable&&<button disabled={saving} className="quiet" onClick={()=>void compare()}>Compare latest settings</button>}
    {latest&&<section className="saved-settings" aria-label="Current saved settings"><h3>Current saved settings</h3><p>Name: {latest.name}</p><p>Provider: {latest.provider}</p><p>Model: {latest.model||'(none)'}</p><p>Instructions:</p><pre>{latest.instructions}</pre></section>}
  </div>;
}

function ArchivedBot({bot,label}:{bot:{id:string;name:string};label:ReactNode}){
  const [busy,setBusy]=useState(false);const [status,setStatus]=useState('');
  async function restore(){setBusy(true);setStatus('');try{const profile=await app.botProfile(bot.id);await app.setArchived(profile,false)}catch(e){setStatus('Could not restore the agent, or the result is uncertain. Refresh and try again. '+String(e));await app.refresh()}finally{setBusy(false)}}
  return <div className="provider"><strong>{label}</strong><button disabled={busy} onClick={()=>void restore()}>Restore agent</button><p role="status">{status}</p></div>;
}

function App(){
  const s=useSyncExternalStore(app.subscribe,app.snapshot);
  const [code,setCode]=useState('');
  const [view,setView]=useState<View>('chat');
  const [appearance,setAppearance]=useState<Appearance>(initialAppearance);
  const [settingsBotId,setSettingsBotId]=useState<string|null>(null);
  const [botSaving,setBotSaving]=useState(false);
  const firstRun=useRef(false);
  const activityButton=useRef<HTMLButtonElement>(null);
  const closeButton=useRef<HTMLButtonElement>(null);
  const messagesRef=useRef<HTMLDivElement>(null);
  const followBottom=useRef(true);
  useLayoutEffect(()=>{followBottom.current=true},[s.selected,view]);
  useLayoutEffect(()=>{const node=messagesRef.current;if(node&&followBottom.current)node.scrollTop=node.scrollHeight},[s.selected,view,s.messages,s.response?.text,s.response?.state]);
  useEffect(()=>{if(s.activityOpen&&document.activeElement===activityButton.current)closeButton.current?.focus()},[s.activityOpen]);
  useEffect(()=>{if(!firstRun.current&&s.connection.kind==='ready'){firstRun.current=true;if(!s.bots.length&&s.credential==='signed-out')setView('settings')}},[s.connection.kind,s.bots.length,s.credential]);
  const selected=s.bots.find(b=>b.id===s.selected);
  const botLabel=(bot:{id:string;name:string})=><>{bot.name}{s.bots.filter(other=>other.name===bot.name).length>1&&<span className="agent-id"> · {bot.id.slice(-4)}</span>}</>;
  const labelFor=(id:string)=>{const bot=s.bots.find(item=>item.id===id);return bot?botLabel(bot):'Agent'};
  const relevant=s.inbox.filter(i=>i.botId===s.selected);
  const submission=s.draft.submission;
  const openBotCreation=()=>{setView('chat');app.openSetup()};
  const openSettings=()=>{app.closeSetup();setView('settings')};
  const chooseAppearance=(value:Appearance)=>{setAppearance(value);applyAppearance(value);try{localStorage.setItem(appearanceKey,value)}catch{/* Appearance still applies for this page. */}};
  const openChat=(id:string)=>{app.closeSetup();setView('chat');app.select(id)};
  return <div className="shell"><aside className="side">
    <div className="brand">✳ <span>staf</span></div>
    <button disabled={botSaving} onClick={openBotCreation}>＋ &nbsp; New agent</button>
    <div className="caption" id="agents-label">Your agents</div>
    <nav aria-labelledby="agents-label">{s.bots.filter(b=>!b.archived).map(b=>{const active=b.id===s.selected&&view==='chat'&&s.setup.kind==='closed';return <button disabled={botSaving} key={b.id} aria-current={active?'page':undefined} className={active?'active':''} onClick={()=>openChat(b.id)}>◉ &nbsp; {botLabel(b)} <span className="dots">{s.inbox.filter(i=>i.botId===b.id).length||''}</span></button>})}</nav>
    <div className="caption">Inbox</div>
    <button disabled={botSaving} className={view==='inbox'?'active':''} onClick={()=>{app.closeSetup();setView(view==='inbox'?'chat':'inbox')}}>◉ &nbsp; Updates <span className="dots">{s.inbox.length||''}</span></button>
    <div className="minor"><button disabled={botSaving} className={view==='settings'?'active':''} onClick={openSettings}>⚙ &nbsp; Settings</button></div>
  </aside><main className="main">
    <header className="top"><div className="avatar">{selected?.name[0]?.toUpperCase()||'✳'}</div><div><div className="title">{view==='settings'?'Settings':selected?botLabel(selected):'Welcome to Staf'}</div><div className="sub">{s.connection.kind==='ready'?(view==='settings'?'Provider connections':view==='bot'?'Agent settings':'Your ongoing conversation'):s.connection.kind}</div></div><div className="spacer"/>
      <button ref={activityButton} className="iconbutton activity-button" aria-label="Activity" title="Activity" onClick={()=>app.activity(!s.activityOpen)}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>{relevant.length>0&&<span className="activity-dot"/>}</button>
    </header>
    {s.notice&&<div className="banner" role="status">{s.notice}</div>}
    {s.connection.kind==='offline'&&<div className="banner" role="alert">{s.connection.message} {s.freshness}</div>}
    {view==='bot'&&settingsBotId?<BotModelSettings key={settingsBotId} id={settingsBotId} saving={botSaving} setSaving={setBotSaving} onClose={()=>{setSettingsBotId(null);setView('chat')}}/>
    :s.connection.kind==='pairing'?<div className="setup"><span className="eyebrow">WELCOME TO STAF</span><h2>Pair this browser</h2><p>Enter the one-time code shown on the host.</p><label>Pairing code<input value={code} onChange={e=>setCode(e.target.value)}/></label><button onClick={()=>void app.pair(code)}>Pair</button><p role="alert">{s.connection.message}</p></div>
    :s.setup.kind==='create'?<div className="setup"><span className="eyebrow">YOUR AGENT</span><h2>Create your agent</h2><p>Give your agent a name. Instructions and provider settings are optional.</p>
      <label>Name<input value={s.setup.name} disabled={!!s.setup.operationId} onChange={e=>app.setupField('name',e.target.value)}/></label>
      <label>What should this agent help with?<textarea value={s.setup.instructions} disabled={!!s.setup.operationId} onChange={e=>app.setupField('instructions',e.target.value)}/></label>
      <label>Provider<select value={s.setup.provider??'codex'} disabled={!!s.setup.operationId} onChange={e=>app.setupField('provider',e.target.value)}><option value="">Instance default</option><option value="demo">Demo</option><option value="codex">Codex</option><option value="openrouter">OpenRouter</option><option value="lmstudio">LM Studio</option><option value="live">HTTP compatible</option></select></label>
      <label>Model<input value={s.setup.model} disabled={!!s.setup.operationId} placeholder="Choose a model for this agent" onChange={e=>app.setupField('model',e.target.value)}/></label>
      <p>Provider connections are shared. Defaults are copied when the agent is created.</p>
      <div className="row">{s.setup.operationId?<><button onClick={()=>void app.checkCreate()}>Check creation</button><button onClick={()=>void app.create(true)}>Retry same creation</button></>:<button onClick={()=>void app.create()}>Create agent</button>}<button className="quiet" onClick={()=>app.closeSetup()}>Close</button></div><p role="status">{s.setup.status}</p>
    </div>:view==='settings'?<div className="setup"><span className="eyebrow">SETTINGS</span><h2>Appearance</h2><p>Choose how Staf looks in this browser.</p>
      <fieldset className="appearance"><legend>Appearance</legend>{(['light','dark','system'] satisfies Appearance[]).map(value=><label key={value}><input type="radio" name="appearance" value={value} checked={appearance===value} onChange={()=>chooseAppearance(value)}/>{value[0].toUpperCase()+value.slice(1)}</label>)}</fieldset>
      {s.bots.some(bot=>bot.archived)&&<><h2>Archived agents</h2>{s.bots.filter(bot=>bot.archived).map(bot=><ArchivedBot key={bot.id} bot={bot} label={botLabel(bot)}/>)}</>}
      <h2>Providers</h2><p>Provider connections belong to this Staf instance and are available to all your agents. Each agent has its own model.</p>
      <div className="provider provider-settings"><strong>Codex</strong><p>{s.credential==='signed-in'?'Saved sign-in found for this instance.':s.credential==='signed-out'?'No usable sign-in found for this instance.':'Checking the sign-in for this instance.'}</p>{s.credential==='signed-in'&&<p className="meta">This saved sign-in has not been checked against the provider.</p>}
        {s.authAttempt&&<p>Sign-in {s.authAttempt.phase}</p>}
        <div className="row"><button onClick={()=>void app.startAuth()}>{s.credential==='signed-in'?'Sign in again':'Connect Codex'}</button>{s.authUrl&&<a href={s.authUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Continue sign-in</a>}{s.authAttempt&&['waiting','exchanging','committing'].includes(s.authAttempt.phase)&&<button className="quiet" onClick={()=>void app.cancelAuth()}>Cancel sign-in</button>}{s.credential==='signed-in'&&<button className="quiet" onClick={()=>{if(window.confirm('Sign out of Codex for this Staf instance? All agents using it will need a new sign-in.'))void app.signOutAuth()}}>Sign out</button>}</div>
      </div><div className="row"><button className="quiet" onClick={()=>setView('chat')}>Back to chat</button>{!s.bots.length&&<button onClick={openBotCreation}>Create an agent</button>}</div>
    </div>:<div className="workspace"><div className="chat">{view==='inbox'?<div className="messages"><h2>Inbox</h2><p>Questions and approvals that need your attention.</p>
      {s.inbox.length?s.inbox.map(item=><div key={item.kind+item.id}><button className="inbox-link" onClick={()=>{if(item.botId)app.select(item.botId);app.activity(true);setView('chat')}}>{item.botId?labelFor(item.botId):'Instance-wide'} · {item.kind==='question'?'Question':item.approvalKind+' approval'}</button>{!item.botId&&<Item item={item}/>}</div>):<p>Nothing needs attention right now.</p>}
      <h3>Task updates</h3>{s.taskUpdates.length?s.taskUpdates.map(task=><article className="item" key={task.id}><button className="inbox-link" onClick={()=>{app.select(task.botId);app.activity(true);setView('chat')}}>{labelFor(task.botId)} · {task.objective}</button><div className="meta">{task.state} · {task.id}</div>{task.outcome&&<p>{task.outcome}</p>}</article>):<p>No task updates yet.</p>}
    </div>:<div className="messages" ref={messagesRef} onScroll={e=>{const node=e.currentTarget;followBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<40}}>{selected?s.messages.length?s.messages.map(m=><div className="message" key={m.id}><div className="who">{m.role==='user'?'YOU':selected.name.toUpperCase()}</div>{m.role==='user'?<div className="bubble">{m.content}</div>:<ResponseText text={m.content}/>}</div>):<div className="empty"><strong>Say hello to {selected.name}</strong><p>This is your ongoing conversation.</p></div>:<div className="empty"><strong>Let's set up your first agent.</strong><p>Create an agent now, even if your provider is not connected.</p><button onClick={openBotCreation}>Create an agent</button></div>}
      {selected&&s.responseConnection==='reconnecting'&&<div className="message meta">Live response updates disconnected. Reconnecting…</div>}
      {selected&&s.response&&s.response.state!=='completed'&&<div className="message provisional"><div className="who">{selected.name.toUpperCase()} · {s.response.state}</div>{s.response.text&&<ResponseText text={s.response.text}/>}<div className="meta">{s.response.state==='failed'||s.response.state==='interrupted'?'Response did not complete. ':'Response in progress. '}{s.response.error}</div></div>}
      {selected?.provider==='codex'&&s.credential==='signed-out'&&<div className="provider"><strong>Connect Codex to chat</strong><p>Provider connections are shared by this Staf instance.</p><button className="quiet" onClick={openSettings}>Open provider settings</button></div>}
      {s.recoveries.length>0&&<details><summary>Recover saved browser drafts or creation</summary><p>Drafts are stored locally in this browser. Choose a record to copy it into the selected agent.</p>{s.recoveries.map(r=><div className="row" key={r.key}><span>{r.label}</span><button className="quiet" onClick={()=>r.key.includes(':creation:')?app.recoverCreation(r):app.adopt(r)}>Recover</button></div>)}</details>}
    </div>}
    {selected&&view==='chat'&&<div className="composer"><textarea aria-label="Message" placeholder={'Message '+selected.name+'…'} value={s.draft.text} onChange={e=>app.edit(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void app.send()}}}/>
      {submission&&<div className="submission">Message {submission.kind}. {submission.error} {submission.kind==='unknown'&&'The original request may still complete.'}<div className="row">{submission.kind==='busy'?<button className="quiet" onClick={()=>app.restoreUnsent()}>Restore unsent message</button>:<button className="quiet" onClick={()=>void app.checkSubmission()}>Check status</button>}{submission.kind==='unknown'&&<button className="quiet" onClick={()=>void app.send(true)}>Retry same message</button>}</div></div>}
      <div className="actions"><button className="model-button" onClick={()=>{setSettingsBotId(selected.id);setView('bot')}} aria-label="Change agent settings">{selected.provider} · {selected.model||'Choose model'}</button><button disabled={!!s.response&&['accepted','running'].includes(s.response.state)||!!submission&&['submitting','pending','unknown','busy'].includes(submission.kind)} onClick={()=>void app.send()}>Send ↑</button></div>
    </div>}</div>
    {s.activityOpen&&<aside className="activity" aria-label="Activity"><h3>Activity <button ref={closeButton} className="quiet close" onClick={()=>{app.activity(false);activityButton.current?.focus()}} aria-label="Close Activity">×</button></h3>{relevant.map(item=><Item key={item.kind+item.id} item={item}/>)}{s.tasks.length?s.tasks.map(task=><article className="item" key={task.id}><strong>{task.objective}</strong><div className="meta">{task.state} · {task.id}</div>{task.outcome&&<p>{task.outcome}</p>}{task.activity?.map((event,index)=><pre key={index}>{JSON.stringify(event,null,2)}</pre>)}</article>):<p className="meta">No tasks recorded for this agent.</p>}</aside>}
    </div>}
  </main></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
