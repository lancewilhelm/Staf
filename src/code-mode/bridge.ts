import {randomUUID} from 'node:crypto';
import {startQuickJSGuest} from './executor.js';
import {limits} from './protocol.js';
import type {Json} from './json.js';
import {ActionDeferred, type WorkActions} from '../work-actions.js';
import {skillEvidence} from '../skill-actions.js';
import type {RuntimeEvent} from '../types.js';

/** Runs one provider-requested program against the accepted work's action coordinator. */
export async function runCode(input:{actions:WorkActions;responseId:string;callId:string;source:string;redact:(text:string)=>string;emit?:(event:RuntimeEvent)=>void;ensureSkills?:()=>void}):Promise<string> {
  const {actions,source,redact}=input;
  if(Buffer.byteLength(source,'utf8')>limits.sourceBytes || redact(source)!==source) throw Error('Source cannot be retained safely or exceeds 32 KiB');
  let id:string;
  try {id=actions.startExecution(input.responseId,input.callId,source);} catch(error) {if(error instanceof ActionDeferred)return JSON.stringify({outcome:'deferred',notice:error.message});throw error;}
  const receipts=new Map<string,Json>(), emitted:Json[]=[];
  const persist=()=>actions.updateExecution(id,JSON.stringify({emitted}));
  let outputBytes=0, cachedBytes=0, fatal:string|undefined;
  const pending=new Set<Promise<unknown>>();
  const safe=(value:Json):Json=>{if(typeof value==='string')return redact(value);if(Array.isArray(value))return value.map(safe);if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[redact(key),safe(item)]));return value;};
  const keep=(value:Json):Json=>{const result=safe(value);outputBytes+=Buffer.byteLength(JSON.stringify(result));if(outputBytes>limits.outputBytes){fatal='Guest output limit reached';actions.close(fatal);throw Error(fatal);}return result;};
  let guest:ReturnType<typeof startQuickJSGuest>;
  try {guest=startQuickJSGuest({source,names:actions.offers('guest').map(tool=>tool.function.name),guestMs:limits.guestMs,phase:()=>{},request:message=>{
    const operation=(async()=>{
    if(fatal || actions.context.signal.aborted) return {ok:false as const,error:'Work stopped or closed'};
    try {
      input.ensureSkills?.();
      if(message.type==='emit') {actions.assertPrivateDisclosure();emitted.push(keep(message.value));persist();return {ok:true as const,value:null};}
      if(message.type==='reuse') {actions.assertPrivateDisclosure();const value=receipts.get(message.receipt);if(value===undefined)return {ok:false as const,error:'Receipt unavailable'};return {ok:true as const,value};}
      const eventId=`${id}:${message.seq}`;
      input.emit?.({type:'tool_start',id:eventId,name:message.name,arguments:JSON.stringify(safe(message.input))});
      let result:Awaited<ReturnType<WorkActions['invoke']>>;
      try {result=await actions.invoke({source:{kind:'guest',executionId:id,sequence:message.seq},name:message.name,input:message.input,intent:message.intent ?? {kind:'new'}});}
      catch(error) {input.emit?.({type:'tool_result',id:eventId,name:message.name,success:false,content:'Capability call failed'});throw error;}
      input.emit?.({type:'tool_result',id:eventId,name:message.name,success:result.kind==='completed',content:result.kind==='completed' && message.name==='select_skill' && typeof result.value==='string' ? JSON.stringify(skillEvidence(result.value) ?? {}) : result.kind==='completed'?'Capability completed':JSON.stringify(result)});
      if(result.kind==='blocked') {if(actions.closedReason()) fatal ??= result.reason;return {ok:false as const,error:result.reason};}
      if(result.kind!=='completed') return {ok:false as const,error:JSON.stringify(result)};
      const receipt=randomUUID(),value=safe(result.value);
      cachedBytes+=Buffer.byteLength(JSON.stringify(value));if(cachedBytes>limits.cacheBytes){fatal='Guest cache limit reached';actions.close(fatal);throw Error(fatal);}receipts.set(receipt,value);
      return {ok:true as const,value:{receipt,actionId:result.actionId,value}};
    } catch(error) {
      if(!fatal && actions.context.signal.aborted && !actions.closedReason()) fatal='Work stopped';
      else if(!fatal && actions.closedReason()) fatal='Action admission closed: '+actions.closedReason();
      return {ok:false as const,error:fatal ?? 'Capability call failed'};
    }
    })();
    pending.add(operation);void operation.finally(()=>pending.delete(operation));return operation;
  }});} catch {actions.close('guest worker unavailable');actions.finishExecution(id,'worker-failed',JSON.stringify({emitted}));throw Error('Guest worker could not start');}
  const stop=()=>guest.stop();actions.context.signal.addEventListener('abort',stop,{once:true});
  if(actions.context.signal.aborted) stop();
  let end:Awaited<typeof guest.finished>;
  try {end=await guest.finished;} finally {actions.context.signal.removeEventListener('abort',stop);}
  if(end.outcome==='worker-failed' || end.outcome==='limit') {fatal='Guest execution limit or worker failure';actions.close(fatal);}
  if((end.outcome==='stopped' || actions.context.signal.aborted) && !fatal && !actions.closedReason()) {fatal='Work stopped';actions.close(fatal);}
  await Promise.allSettled([...pending]);
  if(!fatal && actions.closedReason()) fatal=`Action admission closed: ${actions.closedReason()}`;
  if(actions.context.signal.aborted && !fatal) {fatal='Work stopped';actions.close(fatal);}
  try {actions.assertPrivateDisclosure();} catch {fatal='Gmail permission changed before model disclosure';actions.close('authority');}
  let result:Json={emitted};
  if(end.outcome==='return' && !fatal) {try {result={emitted,value:keep(end.value)};} catch { /* limit closed admission */ }}
  actions.finishExecution(id,fatal?'closed':end.outcome,JSON.stringify(result));
  if(fatal==='Action denied' && !actions.context.workSignal.aborted) return JSON.stringify({executionId:id,outcome:'denied',notice:'Action denied. No further actions are admitted for this work.'});
  if(fatal) throw Error(fatal);
  if(end.outcome!=='return') {
    const manifest=actions.beginRecovery();
    return JSON.stringify({executionId:id,outcome:end.outcome,recovery:manifest,mode:actions.context.mode,notice:actions.context.mode==='code'?'Code Mode remains selected; correct the program or explain the failure.':'Correct the program or continue with offered direct tools.'});
  }
  return JSON.stringify({executionId:id,outcome:end.outcome,...result});
}
