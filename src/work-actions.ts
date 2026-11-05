import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ActionConflict, ActionJournal } from './action-journal.js';
import type { ActionRecord, WorkRef } from './action-journal.js';
import { jsonValue } from './code-mode/json.js';
import type { Json } from './code-mode/json.js';
import type { ToolMode } from './tool-mode.js';
import type { ToolDefinition } from './types.js';

export const workActionsSchema = `
CREATE TABLE IF NOT EXISTS work_action_state (kind TEXT NOT NULL, work_id TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, closed TEXT, epoch INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(kind,work_id));
CREATE TABLE IF NOT EXISTS work_action_invocations (kind TEXT NOT NULL, work_id TEXT NOT NULL, source TEXT NOT NULL, digest TEXT NOT NULL, action_id TEXT NOT NULL REFERENCES action_journal(id), capability TEXT NOT NULL, input TEXT NOT NULL, description TEXT NOT NULL, private_result TEXT, PRIMARY KEY(kind,work_id,source));
CREATE TABLE IF NOT EXISTS work_action_requests (kind TEXT NOT NULL, work_id TEXT NOT NULL, source TEXT NOT NULL, digest TEXT NOT NULL, challenge TEXT, reason TEXT, PRIMARY KEY(kind,work_id,source), CHECK ((challenge IS NOT NULL) != (reason IS NOT NULL)));
CREATE TABLE IF NOT EXISTS work_action_challenges (id TEXT PRIMARY KEY, kind TEXT NOT NULL, work_id TEXT NOT NULL, epoch INTEGER NOT NULL, digest TEXT NOT NULL, prior_ids TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS work_action_resolutions (action_id TEXT PRIMARY KEY REFERENCES action_journal(id));
`;

export type WorkContext = Readonly<{work:WorkRef; botId:string; conversation:{kind:'chat';conversationId:string} | {kind:'task';conversationId:string;context:unknown}; mode:ToolMode; workingDirectory:string; signal:AbortSignal}>;
export type InvocationSource = {kind:'provider';responseId:string;callId:string} | {kind:'guest';executionId:string;sequence:number};
export type ActionIntent = {kind:'new'} | {kind:'resume';actionId:string} | {kind:'repeat';challenge:string};
export type Description = {summary:string;resource:string;effect:'read'|'change';opaque?:boolean};
export type Capability<I,O> = {
  name:string;
  definition:ToolDefinition;
  parseInput(input:unknown):I;
  parseResult(output:unknown):O;
  describe(input:I,work:WorkContext):Description;
  eligible(work:WorkContext):boolean;
  check(input:I,work:WorkContext):void;
  authorize(input:I,work:WorkContext):Promise<void>;
  execute(input:I,work:WorkContext):Promise<O>;
  visibleResult(output:O):string;
  recovery?: {overlaps?(previous:I,next:I,work:WorkContext):boolean; reconcile?(input:I,evidence:unknown,work:WorkContext):boolean};
};
export class ActionDenied extends Error {}
/** Reject input before journaling, or establish a definite failed effect outcome. */
export class ActionFailed extends Error {
  constructor(readonly safeResult:string) {super('Action failed');}
}
export function closesAdmission(reason:string):boolean {return ['Action limit reached','Action denied','Action authorization failed','Action could not start','Work stopped'].includes(reason);}
export type RecoveryManifest = {actions:ActionRecord[];truncated:boolean;instructions:string};
export type InvocationResult = {kind:'completed';actionId:string;value:Json} | {kind:'status';action:ActionRecord} | {kind:'repeat-required';actions:ActionRecord[];truncated:boolean;challenge:string} | {kind:'blocked';reason:string};

function stable(value:Json):string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key]!)}`).join(',')}}`;
  return JSON.stringify(value);
}
function encoded(value:unknown):string {return stable(jsonValue.parse(value));}
function sourceKey(source:InvocationSource):string {
  if (source.kind==='provider' && source.responseId && source.callId) return encoded(source);
  if (source.kind==='guest' && source.executionId && Number.isSafeInteger(source.sequence) && source.sequence>0) return encoded(source);
  throw Error('Invalid invocation source');
}

type ErasedCapability = {
  name:string;definition:ToolDefinition;eligible(work:WorkContext):boolean;
  parse(input:unknown):Json;describe(input:Json,work:WorkContext):Description;
  check(input:Json,work:WorkContext):void;authorize(input:Json,work:WorkContext):Promise<void>;
  execute(input:Json,work:WorkContext):Promise<Json>;visible(output:Json):string;
  overlaps?: (previous:Json,next:Json,work:WorkContext)=>boolean;
  reconcile?: (input:Json,evidence:unknown,work:WorkContext)=>boolean;
};

/** One instance owns this coordinator and its registry. Callers cannot choose action IDs. */
export class WorkActionService {
  private readonly capabilities=new Map<string,ErasedCapability>();
  private readonly queues=new Map<string,Promise<void>>();
  private readonly queueDepth=new Map<string,number>();
  private readonly journal:ActionJournal;
  private readonly closures=new Map<string,{controller:AbortController;refs:number}>();
  constructor(private readonly db:DatabaseSync, private readonly key:Uint8Array,
    private readonly context:(work:WorkRef,signal:AbortSignal)=>WorkContext,
    private readonly active:(work:WorkRef)=>void, private readonly budget=32) {
    this.journal=new ActionJournal(db);
  }
  register<I,O>(capability:Capability<I,O>):void {
    if (!capability.name || capability.name==='code_mode' || this.capabilities.has(capability.name) || capability.definition.function.name!==capability.name) throw Error('Invalid or duplicate capability');
    const parse=(input:unknown)=>capability.parseInput(input);
    this.capabilities.set(capability.name,{
      name:capability.name,definition:structuredClone(capability.definition),eligible:capability.eligible,
      parse:input=>jsonValue.parse(parse(input)),
      describe:(input,work)=>capability.describe(parse(input),work),
      check:(input,work)=>capability.check(parse(input),work),
      authorize:(input,work)=>capability.authorize(parse(input),work),
      execute:async (input,work)=>jsonValue.parse(capability.parseResult(await capability.execute(parse(input),work))),
      visible:output=>capability.visibleResult(capability.parseResult(output)),
      ...(capability.recovery?.overlaps ? {overlaps:(a:Json,b:Json,work:WorkContext)=>capability.recovery!.overlaps!(parse(a),parse(b),work)} : {}),
      ...(capability.recovery?.reconcile ? {reconcile:(input:Json,evidence:unknown,work:WorkContext)=>capability.recovery!.reconcile!(parse(input),evidence,work)} : {}),
    });
  }
  open(work:WorkRef,signal:AbortSignal):WorkActions {
    const key=encoded(work),entry=this.closures.get(key) ?? {controller:new AbortController(),refs:0};
    entry.refs++;this.closures.set(key,entry);
    try {
      const context=this.context(work,AbortSignal.any([signal,entry.controller.signal]));
      return new WorkActions(this,context,()=>{if(--entry.refs===0 && this.closures.get(key)===entry)this.closures.delete(key);});
    } catch(error) {if(--entry.refs===0)this.closures.delete(key);throw error;}
  }
  offers(context:WorkContext,route:'direct'|'guest'):ToolDefinition[] {
    if ((route==='direct' && context.mode==='code') || (route==='guest' && context.mode==='direct')) return [];
    return [...this.capabilities.values()].filter(cap=>cap.eligible(context)).map(cap=>structuredClone(cap.definition));
  }
  recognizes(name:string):boolean {return this.capabilities.has(name);}
  private digest(value:string):string {return createHmac('sha256',this.key).update(value).digest('hex');}
  private state(work:WorkRef) {const recovery=work.kind==='task' && !!this.db.prepare('SELECT 1 FROM task_attempts WHERE id=? AND predecessor IS NOT NULL').get(work.id);this.db.prepare('INSERT OR IGNORE INTO work_action_state(kind,work_id,epoch) VALUES (?,?,?)').run(work.kind,work.id,recovery?1:0);return this.db.prepare('SELECT used,closed,epoch FROM work_action_state WHERE kind=? AND work_id=?').get(work.kind,work.id)!;}
  private admit(context:WorkContext):void {
    const state=this.state(context.work);if (typeof state.closed==='string') throw Error(`Action admission closed: ${state.closed}`);
    try {context.signal.throwIfAborted();this.active(context.work);} catch(error) {this.close(context,context.signal.aborted?'stopped':'authority');throw error;}
  }
  private records(context:WorkContext):Array<{action:ActionRecord;capability:string;input:Json;description:Description}> {
    const rows=this.db.prepare(`WITH RECURSIVE lineage(id) AS (SELECT ? UNION ALL SELECT predecessor FROM task_attempts JOIN lineage ON task_attempts.id=lineage.id WHERE predecessor IS NOT NULL)
      SELECT i.action_id,i.capability,i.input,i.description FROM work_action_invocations i WHERE (i.kind=? AND i.work_id=?) OR (?='task' AND i.kind='task' AND i.work_id IN lineage) GROUP BY i.action_id ORDER BY MIN(i.rowid)`).all(context.work.id,context.work.kind,context.work.id,context.work.kind);
    const records=rows.map(row=>{const action=this.journal.get(String(row.action_id));if (!action) throw Error('Missing journal action');return {action,capability:String(row.capability),input:jsonValue.parse(JSON.parse(String(row.input))),description:JSON.parse(String(row.description)) as Description};});
    const unknown=this.db.prepare(`WITH RECURSIVE lineage(id) AS (SELECT ? UNION ALL SELECT predecessor FROM task_attempts JOIN lineage ON task_attempts.id=lineage.id WHERE predecessor IS NOT NULL) SELECT a.id FROM action_journal a WHERE a.state IN ('started','uncertain') AND ((?='command' AND a.command_id=?) OR (?='task' AND a.task_attempt_id IN lineage)) AND NOT EXISTS (SELECT 1 FROM work_action_invocations i WHERE i.action_id=a.id)`).all(context.work.id,context.work.kind,context.work.id,context.work.kind);
    for(const row of unknown) {const action=this.journal.get(String(row.id));if(action)records.push({action,capability:'',input:null,description:{summary:action.summary,resource:'unknown',effect:'change',opaque:true}});}
    return records;
  }
  manifest(context:WorkContext):RecoveryManifest {const records=this.records(context).map(item=>item.action);return {actions:records.slice(-32),truncated:records.length>32,instructions:'Resume a completed action by ID. Reconcile uncertain changes before overlapping work. A matching completed change requires a repeat challenge.'};}
  beginRecovery(context:WorkContext):RecoveryManifest {
    this.admit(context);this.db.prepare('UPDATE work_action_state SET epoch=epoch+1 WHERE kind=? AND work_id=?').run(context.work.kind,context.work.id);return this.manifest(context);
  }
  reconcile(context:WorkContext,actionId:string,evidence:unknown):void {
    this.admit(context);const record=this.records(context).find(item=>item.action.id===actionId && (item.action.state==='uncertain' || (item.action.state==='succeeded' && item.description.effect==='change' && item.description.opaque)));
    const cap=record && this.capabilities.get(record.capability);
    if (!record || !cap?.reconcile || !cap.reconcile(record.input,evidence,context)) throw Error('Feature reconciliation did not establish the outcome');
    this.db.prepare('INSERT OR IGNORE INTO work_action_resolutions VALUES (?)').run(actionId);
  }
  closedReason(context:WorkContext):string|null {const reason=this.state(context.work).closed;return typeof reason==='string'?reason:null;}
  close(context:WorkContext, reason:string):void {
    this.state(context.work);
    this.db.prepare('UPDATE work_action_state SET closed=COALESCE(closed,?) WHERE kind=? AND work_id=?').run(reason,context.work.kind,context.work.id);
    this.closures.get(encoded(context.work))?.controller.abort();
  }
  startExecution(context:WorkContext,responseId:string,callId:string,source:string):string {
    this.admit(context);
    if(!responseId || !callId || Buffer.byteLength(encoded([responseId,callId]))>2048)throw Error('Invalid provider call identity');
    const count=this.db.prepare('SELECT count(*) AS n FROM code_executions WHERE kind=? AND work_id=?').get(context.work.kind,context.work.id);
    if(Number(count?.n)>=4) {this.close(context,'guest execution limit');throw Error('Guest execution limit reached');}
    const id=randomUUID(),hash=createHash('sha256').update(source).digest('hex');
    this.db.prepare("INSERT INTO code_executions VALUES (?,?,?,?,?,?,?,'running',NULL)").run(id,context.work.kind,context.work.id,responseId,callId,source,hash);
    return id;
  }
  updateExecution(context:WorkContext,id:string,result:string):void {
    this.db.prepare("UPDATE code_executions SET result=? WHERE id=? AND kind=? AND work_id=? AND outcome='running'").run(result,id,context.work.kind,context.work.id);
  }
  finishExecution(context:WorkContext,id:string,outcome:string,result:string|null):void {
    this.db.prepare("UPDATE code_executions SET outcome=?,result=? WHERE id=? AND kind=? AND work_id=? AND outcome='running'").run(outcome,result,id,context.work.kind,context.work.id);
  }
  inspect(work:WorkRef) {
    const executions=this.db.prepare('SELECT id,response_id AS responseId,call_id AS callId,source,source_hash AS sourceHash,outcome,result FROM code_executions WHERE kind=? AND work_id=? ORDER BY rowid').all(work.kind,work.id);
    return executions.map(row=>({...row,result:typeof row.result==='string'?JSON.parse(row.result):null,actions:this.db.prepare("SELECT action_id AS actionId FROM work_action_invocations WHERE kind=? AND work_id=? AND json_extract(source,'$.kind')='guest' AND json_extract(source,'$.executionId')=? ORDER BY rowid").all(work.kind,work.id,String(row.id)).map(item=>item.actionId)}));
  }
  inspectActions(work:WorkRef) {
    const column=work.kind==='command'?'command_id':'task_attempt_id';
    return this.db.prepare(`SELECT id FROM action_journal WHERE ${column}=? ORDER BY rowid`).all(work.id).map(row=>this.journal.get(String(row.id)));
  }
  async invoke(context:WorkContext,request:{source:InvocationSource;name:string;input:unknown;intent:ActionIntent}):Promise<InvocationResult> {
    const snapshot=structuredClone(request);
    const queueKey=encoded(context.work),prior=this.queues.get(queueKey)??Promise.resolve();
    const depth=this.queueDepth.get(queueKey)??0;if(depth>=8){this.close(context,'pending action limit');throw Error('Too many pending actions');}this.queueDepth.set(queueKey,depth+1);
    let release!:()=>void;const next=new Promise<void>(resolve=>{release=resolve;});this.queues.set(queueKey,next);
    try {await prior;return await this.dispatch(context,snapshot);} finally {release();const remaining=(this.queueDepth.get(queueKey)??1)-1;if(remaining)this.queueDepth.set(queueKey,remaining);else this.queueDepth.delete(queueKey);if(this.queues.get(queueKey)===next)this.queues.delete(queueKey);}
  }
  private async dispatch(context:WorkContext,request:{source:InvocationSource;name:string;input:unknown;intent:ActionIntent}):Promise<InvocationResult> {
    this.admit(context);
    const route=request.source.kind==='provider'?'direct':'guest';
    const cap=this.capabilities.get(request.name);
    if (!cap || (route==='direct' && context.mode==='code') || (route==='guest' && context.mode==='direct')) throw Error('Capability is not offered for this work');
    if(!cap.eligible(context)) {this.close(context,'authority');throw Error('Capability is no longer authorized');}
    const source=sourceKey(request.source),rawInput=jsonValue.parse(request.input),raw=encoded(rawInput);
    if(Buffer.byteLength(source)>2048 || Buffer.byteLength(raw)>256*1024)throw Error('Invocation input exceeds the limit');
    let input:Json;
    try {input=cap.parse(rawInput);}
    catch(error){if(error instanceof ActionFailed)return {kind:'blocked',reason:error.safeResult.slice(0,16000)};throw error;}
    const canonical=encoded(input);
    if(Buffer.byteLength(canonical)>256*1024)throw Error('Parsed input exceeds the limit');
    const digest=this.digest(encoded([request.name,rawInput,request.intent]));
    const pending=this.db.prepare('SELECT digest,challenge,reason FROM work_action_requests WHERE kind=? AND work_id=? AND source=?').get(context.work.kind,context.work.id,source);
    if(pending) {
      if(pending.digest!==digest) throw new ActionConflict('Invocation identity conflicts with recorded input');
      if(typeof pending.reason==='string')return {kind:'blocked',reason:pending.reason};
      if(typeof pending.challenge!=='string')throw Error('Invalid recovery challenge');
      cap.check(input,context);
      const previous=this.db.prepare('SELECT epoch,prior_ids,consumed FROM work_action_challenges WHERE id=?').get(pending.challenge);
      if(typeof previous?.prior_ids!=='string') throw Error('Missing recovery challenge');
      const state=this.state(context.work);
      const matching=this.records(context).filter(item=>item.action.state==='succeeded' && item.capability===request.name && encoded(item.input)===canonical).map(item=>item.action);
      const priorIds=JSON.stringify(matching.map(item=>item.id));
      if(previous.epoch!==state.epoch || previous.prior_ids!==priorIds || previous.consumed!==0) {
        const challenge=randomUUID();
        this.db.prepare('INSERT INTO work_action_challenges VALUES (?,?,?,?,?,?,0)').run(challenge,context.work.kind,context.work.id,Number(state.epoch),this.digest(encoded([request.name,input])),priorIds);
        this.db.prepare('UPDATE work_action_requests SET challenge=? WHERE kind=? AND work_id=? AND source=?').run(challenge,context.work.kind,context.work.id,source);
        return {kind:'repeat-required',actions:matching.slice(-32),truncated:matching.length>32,challenge};
      }
      return {kind:'repeat-required',actions:matching.slice(-32),truncated:matching.length>32,challenge:pending.challenge};
    }
    const existing=this.db.prepare('SELECT digest,action_id,private_result FROM work_action_invocations WHERE kind=? AND work_id=? AND source=?').get(context.work.kind,context.work.id,source);
    if (existing) {
      if(existing.digest!==digest)throw new ActionConflict('Invocation identity conflicts with recorded input');
      const action=this.journal.get(String(existing.action_id));if(!action)throw Error('Missing journal action');cap.check(input,context);
      const saved=this.db.prepare('SELECT private_result FROM work_action_invocations WHERE action_id=? AND private_result IS NOT NULL LIMIT 1').get(action.id);
      if(action.state==='succeeded' && typeof saved?.private_result==='string')return {kind:'completed',actionId:action.id,value:jsonValue.parse(JSON.parse(saved.private_result))};
      return {kind:'status',action};
    }
    const state=this.state(context.work);
    if(Number(state.used)>=this.budget) {this.close(context,'limit');return {kind:'blocked',reason:'Action limit reached'};}
    this.db.prepare('UPDATE work_action_state SET used=used+1 WHERE kind=? AND work_id=?').run(context.work.kind,context.work.id);
    const records=this.records(context);
    if(request.intent.kind==='resume') {
      const actionId=request.intent.actionId;
      const record=records.find(item=>item.action.id===actionId);
      if(!record || record.capability!==request.name || encoded(record.input)!==canonical)throw new ActionConflict('Resume does not match the recorded action');
      cap.check(input,context);
      this.db.prepare('INSERT INTO work_action_invocations (kind,work_id,source,digest,action_id,capability,input,description) VALUES (?,?,?,?,?,?,?,?)').run(context.work.kind,context.work.id,source,digest,record.action.id,record.capability,canonical,JSON.stringify(record.description));
      const saved=this.db.prepare('SELECT private_result FROM work_action_invocations WHERE action_id=? AND private_result IS NOT NULL LIMIT 1').get(record.action.id);
      if(record.action.state==='succeeded' && typeof saved?.private_result==='string')return {kind:'completed',actionId:record.action.id,value:jsonValue.parse(JSON.parse(saved.private_result))};
      return {kind:'status',action:record.action};
    }
    const description=cap.describe(input,context);
    if(!description.summary || !description.resource || !['read','change'].includes(description.effect))throw Error('Invalid action description');
    if(description.effect==='change') {
      const uncertain=records.filter(item=>(item.action.state==='uncertain' || item.action.state==='started') && item.description.effect==='change' && !this.db.prepare('SELECT 1 FROM work_action_resolutions WHERE action_id=?').get(item.action.id));
      if(uncertain.some(item=>item.description.opaque || description.opaque || item.capability!==request.name || !cap.overlaps || cap.overlaps(item.input,input,context))) {
        const reason='Uncertain overlapping change requires reconciliation';
        this.db.prepare('INSERT INTO work_action_requests VALUES (?,?,?,?,NULL,?)').run(context.work.kind,context.work.id,source,digest,reason);return {kind:'blocked',reason};
      }
      const state=this.state(context.work);
      const matching=Number(state.epoch)>0 ? records.filter(item=>item.action.state==='succeeded' && item.capability===request.name && encoded(item.input)===canonical).map(item=>item.action) : [];
      const ambiguous=Number(state.epoch)>0 && records.some(item=>item.action.state==='succeeded' && item.description.effect==='change' && (item.description.opaque || description.opaque) && !(item.capability===request.name && encoded(item.input)===canonical) && !this.db.prepare('SELECT 1 FROM work_action_resolutions WHERE action_id=?').get(item.action.id));
      if(ambiguous) {
        const reason='Opaque prior change requires reconciliation';
        this.db.prepare('INSERT INTO work_action_requests VALUES (?,?,?,?,NULL,?)').run(context.work.kind,context.work.id,source,digest,reason);return {kind:'blocked',reason};
      }
      if(matching.length && request.intent.kind==='new') {
        const challenge=randomUUID();this.db.prepare('INSERT INTO work_action_challenges VALUES (?,?,?,?,?,?,0)').run(challenge,context.work.kind,context.work.id,Number(state.epoch),this.digest(encoded([request.name,input])),JSON.stringify(matching.map(item=>item.id)));
        this.db.prepare('INSERT INTO work_action_requests VALUES (?,?,?,?,?,NULL)').run(context.work.kind,context.work.id,source,digest,challenge);
        return {kind:'repeat-required',actions:matching.slice(-32),truncated:matching.length>32,challenge};
      }
      if(request.intent.kind==='repeat') {
        const challenge=this.db.prepare('SELECT * FROM work_action_challenges WHERE id=?').get(request.intent.challenge);
        if(!challenge || challenge.kind!==context.work.kind || challenge.work_id!==context.work.id || challenge.epoch!==state.epoch || challenge.digest!==this.digest(encoded([request.name,input])) || challenge.prior_ids!==JSON.stringify(matching.map(item=>item.id)) || challenge.consumed!==0)throw new ActionConflict('Repeat challenge is invalid or stale');
      }
    } else if(request.intent.kind==='repeat') throw new ActionConflict('Repeat challenge requires a completed change');
    const actionId=randomUUID(),fingerprint=this.digest(encoded([context.work,request.name,input,actionId]));
    this.db.exec('BEGIN IMMEDIATE');let prepared:ReturnType<ActionJournal['prepareInInstanceTransaction']>;
    try {
      this.admit(context);
      if(request.intent.kind==='repeat' && this.db.prepare('UPDATE work_action_challenges SET consumed=1 WHERE id=? AND consumed=0').run(request.intent.challenge).changes!==1)throw new ActionConflict('Repeat challenge already consumed');
      prepared=this.journal.prepareInInstanceTransaction({id:actionId,fingerprint,work:context.work,summary:description.summary},this.db);
      this.db.prepare('INSERT INTO work_action_invocations (kind,work_id,source,digest,action_id,capability,input,description) VALUES (?,?,?,?,?,?,?,?)').run(context.work.kind,context.work.id,source,digest,actionId,request.name,canonical,JSON.stringify(description));
      this.db.exec('COMMIT');
    } catch(error){this.db.exec('ROLLBACK');throw error;}
    if(prepared.kind!=='created')throw Error('New action already exists');
    try {cap.check(input,context);await cap.authorize(input,context);this.admit(context);cap.check(input,context);}
    catch(error){this.journal.cancel(actionId);const reason=context.signal.aborted?'Work stopped':error instanceof ActionDenied?'Action denied':'Action authorization failed';this.close(context,'authority');return {kind:'blocked',reason};}
    this.db.exec('BEGIN IMMEDIATE');
    try {this.admit(context);cap.check(input,context);this.journal.startInInstanceTransaction(prepared.permit,this.db,{id:actionId,fingerprint,work:context.work});this.db.exec('COMMIT');this.journal.finalizeInstanceStart(prepared.permit);}
    catch(error){this.db.exec('ROLLBACK');this.journal.cancel(actionId);this.close(context,'authority');return {kind:'blocked',reason:context.signal.aborted?'Work stopped':'Action could not start'};}
    let output:Json;let visible:string;
    try {output=await cap.execute(input,context);if(Buffer.byteLength(encoded(output))>256*1024)throw Error('Result exceeds the limit');visible=cap.visible(output).slice(0,16000);} catch(error) {this.journal.finish(actionId,error instanceof ActionFailed?'failed':'uncertain',error instanceof ActionFailed?error.safeResult.slice(0,16000):'Outcome unknown');this.admit(context);cap.check(input,context);return {kind:'status',action:this.journal.get(actionId)!};}
    this.db.prepare('UPDATE work_action_invocations SET private_result=? WHERE action_id=?').run(encoded(output),actionId);
    this.journal.finish(actionId,'succeeded',visible);
    this.admit(context);cap.check(input,context);
    return {kind:'completed',actionId,value:output};
  }
}

export class WorkActions {
  private disposed=false;
  constructor(private readonly service:WorkActionService,readonly context:WorkContext,private readonly release:()=>void) {}
  dispose() {if(!this.disposed){this.disposed=true;this.release();}}
  offers(route:'direct'|'guest') {return this.service.offers(this.context,route);}
  recognizes(name:string) {return this.service.recognizes(name);}
  invoke(request:{source:InvocationSource;name:string;input:unknown;intent:ActionIntent}) {return this.service.invoke(this.context,request);}
  beginRecovery() {return this.service.beginRecovery(this.context);}
  manifest() {return this.service.manifest(this.context);}
  reconcile(actionId:string,evidence:unknown) {return this.service.reconcile(this.context,actionId,evidence);}
  closedReason() {return this.service.closedReason(this.context);}
  close(reason:string) {this.service.close(this.context,reason);}
  startExecution(responseId:string,callId:string,source:string) {return this.service.startExecution(this.context,responseId,callId,source);}
  updateExecution(id:string,result:string) {this.service.updateExecution(this.context,id,result);}
  finishExecution(id:string,outcome:string,result:string|null) {this.service.finishExecution(this.context,id,outcome,result);}
}
