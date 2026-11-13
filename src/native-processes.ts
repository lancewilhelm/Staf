import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { agentProcessEnvironment, byteStreamRedactor, type ByteRedactor } from './config.js';
import { ActionFailed } from './work-actions.js';
import {ptyBackend} from './native-pty.js';
import type { Capability, WorkContext, ActionIdentity } from './work-actions.js';

export const nativeProcessSchema = `
CREATE TABLE IF NOT EXISTS native_processes (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, work_kind TEXT NOT NULL, work_id TEXT NOT NULL, action_id TEXT NOT NULL REFERENCES action_journal(id), cwd TEXT NOT NULL, mode TEXT NOT NULL, state TEXT NOT NULL, pid INTEGER, exit_code INTEGER, exit_signal TEXT, stop_requested INTEGER NOT NULL DEFAULT 0, output_complete INTEGER NOT NULL DEFAULT 0, next_cursor INTEGER NOT NULL DEFAULT 0, first_cursor INTEGER NOT NULL DEFAULT 0, created_ms INTEGER NOT NULL,retained INTEGER NOT NULL DEFAULT 0,input_closed INTEGER NOT NULL DEFAULT 0,input_bytes INTEGER NOT NULL DEFAULT 0,cols INTEGER,rows INTEGER);
CREATE TABLE IF NOT EXISTS native_process_output (process_id TEXT NOT NULL REFERENCES native_processes(id), cursor INTEGER NOT NULL, stream TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(process_id,cursor));
`;
export const nativeProcessLimits = Object.freeze({active:16, outputBytes:128*1024, pageBytes:48*1024,inputBytes:16*1024,pendingInputs:8,ptyInputBytes:1024*1024, settleMs:200, shutdownMs:3000});
export type ProcessObservers = {started:(pid:number|null)=>void;output:(stream:'stdout'|'stderr'|'terminal',data:Buffer)=>void;failed:()=>void;exited:(code:number|null,signal:string|null)=>void;closed:(code:number|null,signal:string|null)=>void;lost:()=>void};
export type ProcessHandle = {terminate:(signal:NodeJS.Signals)=>void;detach:()=>void;write?:(data:Buffer)=>Promise<void>;end?:()=>Promise<void>;resize?:(cols:number,rows:number)=>void};
/** Backends deliver observations asynchronously after launch returns. */
export type ProcessBackend = {launch:(cwd:string,observers:ProcessObservers)=>ProcessHandle};
type Live = {handle:ProcessHandle; signal:AbortSignal; abort:()=>void; timer?:ReturnType<typeof setTimeout>; finished:Promise<void>; done:()=>void;flush:()=>void};

function pipeBackend(command:string,environment=agentProcessEnvironment(process.env)):ProcessBackend {
  return {launch:(cwd,observers)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('./native-process-supervisor.js',import.meta.url)),command],{cwd,env:environment,detached:true,stdio:['pipe','pipe','pipe','ipc']});
    const stdin=child.stdin;if(!stdin)throw Error('Process input pipe was not created');stdin.on('error',()=>{});
    let code:number|null=null,signal:string|null=null,completed=false,failed=false;
    child.stdout?.on('data',(data:Buffer)=>observers.output('stdout',data));child.stderr?.on('data',(data:Buffer)=>observers.output('stderr',data));
    child.once('spawn',()=>observers.started(child.pid ?? null));child.once('error',()=>{failed=true;observers.failed();});
    child.on('message',message=>{
      if(!message || typeof message!=='object' || !('type' in message))return;
      if(message.type==='failed'){failed=true;observers.failed();}
      if(message.type==='exited' && 'code' in message && 'signal' in message && (typeof message.code==='number' || message.code===null) && (typeof message.signal==='string' || message.signal===null)) {code=message.code;signal=message.signal;observers.exited(code,signal);}
      if(message.type==='closed')completed=true;
    });
    child.once('close',()=>{if(completed || failed)observers.closed(code,signal);else observers.lost();});
    return {terminate:signal=>{if(child.connected)child.send(signal,()=>{});},write:data=>new Promise<void>((resolve,reject)=>{stdin.write(data,error=>error?reject(error):resolve());}),end:()=>new Promise<void>(resolve=>stdin.end(resolve)),detach:()=>{child.removeAllListeners();child.on('error',()=>{});child.stdout?.removeAllListeners();child.stderr?.removeAllListeners();if(child.connected)child.disconnect();}};
  }};
}

/** Owns pipe processes and their observations. A later PTY backend must use the same ownership and lifecycle. */
export class NativeProcesses {
  private readonly live=new Map<string,Live>();
  private readonly interactions=new Map<string,{tail:Promise<void>;pending:number}>();
  private closing=false;
  constructor(private readonly db:DatabaseSync,private readonly outputFilter:()=>ByteRedactor=()=>byteStreamRedactor({})) {
    db.exec("UPDATE native_processes SET state='unknown' WHERE state IN ('starting','running','stopping')");
  }
  list() {return this.db.prepare('SELECT id FROM native_processes ORDER BY created_ms DESC, rowid DESC LIMIT 200').all().map(row=>this.get(String(row.id)));}
  forWork(work:WorkContext['work']) {return this.db.prepare('SELECT id FROM native_processes WHERE work_kind=? AND work_id=? ORDER BY created_ms').all(work.kind,work.id).map(row=>this.get(String(row.id)));}
  get(id:string) {
    const row=this.db.prepare('SELECT * FROM native_processes WHERE id=?').get(id);if(!row)return null;
    return {id:row.id,botId:row.bot_id,work:{kind:row.work_kind,id:row.work_id},actionId:row.action_id,cwd:row.cwd,mode:row.mode,retained:row.retained===1,inputClosed:row.input_closed===1,inputBytes:row.input_bytes,cols:row.cols,rows:row.rows,state:row.state,pid:row.pid,exitCode:row.exit_code,exitSignal:row.exit_signal,stopRequested:row.stop_requested===1,outputComplete:row.output_complete===1,firstCursor:row.first_cursor,nextCursor:row.next_cursor,limits:nativeProcessLimits};
  }
  reconcileRun(work:WorkContext,action:ActionIdentity,evidence:unknown):boolean {
    const parsed=z.strictObject({processId:z.string().uuid(),observedCursor:z.number().int().nonnegative()}).safeParse(evidence);
    if(!parsed.success)return false;
    const process=this.get(parsed.data.processId);
    return !!process && process.botId===work.botId && process.actionId===action.id && ['exited','failed'].includes(String(process.state)) && process.outputComplete && process.nextCursor===parsed.data.observedCursor;
  }
  output(id:string,cursor=0) {
    const process=this.get(id);if(!process)throw Error('Process not found');
    if(!Number.isSafeInteger(cursor)||cursor<0)throw Error('Invalid output cursor');
    const first=Number(process.firstCursor),next=Number(process.nextCursor);
    if(cursor>next)throw Error('Output cursor is beyond the observed output');
    const rows=this.db.prepare('SELECT cursor,stream,data FROM native_process_output WHERE process_id=? AND cursor>=? ORDER BY cursor').all(id,Math.max(cursor,first));
    let bytes=0,pageNext=Math.max(cursor,first);
    const chunks=[];
    for(const row of rows) {
      if(!(row.data instanceof Uint8Array))throw Error('Invalid stored process output');
      const data=Buffer.from(row.data);if(bytes+data.length>nativeProcessLimits.pageBytes)break;
      bytes+=data.length;pageNext=Number(row.cursor)+1;
      let text:string|null=null;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{/* Base64 preserves bytes that are not a complete UTF-8 chunk. */}
      chunks.push({cursor:row.cursor,stream:row.stream,data:data.toString('base64'),text});
    }
    return {processId:id,process,encoding:'base64',redaction:'known-credentials',gap:cursor<first,firstCursor:first,nextCursor:pageNext,observedCursor:next,hasMore:pageNext<next,chunks,limits:nativeProcessLimits};
  }
  private append(id:string,stream:'stdout'|'stderr'|'terminal',buffer:Buffer) {
    // Each event is bounded independently so one large write cannot exceed retention.
    for(let offset=0;offset<buffer.length;offset+=8192) {
      const data=buffer.subarray(offset,offset+8192);
      const row=this.db.prepare('SELECT next_cursor FROM native_processes WHERE id=?').get(id);if(!row)return;
      this.db.prepare('INSERT INTO native_process_output VALUES (?,?,?,?)').run(id,Number(row.next_cursor),stream,data);
      this.db.prepare('UPDATE native_processes SET next_cursor=next_cursor+1 WHERE id=?').run(id);
      let size=Number(this.db.prepare('SELECT COALESCE(SUM(length(data)),0) AS size FROM native_process_output WHERE process_id=?').get(id)?.size);
      while(size>nativeProcessLimits.outputBytes) {
        const oldest=this.db.prepare('SELECT cursor,length(data) AS size FROM native_process_output WHERE process_id=? ORDER BY cursor LIMIT 1').get(id);if(!oldest)break;
        this.db.prepare('DELETE FROM native_process_output WHERE process_id=? AND cursor=?').run(id,Number(oldest.cursor));
        this.db.prepare('UPDATE native_processes SET first_cursor=? WHERE id=?').run(Number(oldest.cursor)+1,id);size-=Number(oldest.size);
      }
    }
  }
  start(work:WorkContext,action:ActionIdentity,input:{command:string;cwd?:string;mode?:'pipe'|'pty';retain?:boolean;cols?:number;rows?:number},environment=agentProcessEnvironment(process.env)) {
    const mode=input.mode??'pipe',cols=input.cols??80,rows=input.rows??24;
    return this.startBackend(work,action,{cwd:input.cwd,mode,retain:input.retain,cols:mode==='pty'?cols:undefined,rows:mode==='pty'?rows:undefined,backend:mode==='pty'?ptyBackend(input.command,cols,rows,environment):pipeBackend(input.command,environment)});
  }
  /** Register ownership before launch; #85 can supply a PTY backend through this seam. */
  async startBackend(work:WorkContext,action:ActionIdentity,input:{cwd?:string;baseCwd?:string;mode:string;retain?:boolean;cols?:number;rows?:number;backend:ProcessBackend}) {
    if(this.closing)throw Error('Process admission closed');
    work.signal.throwIfAborted();if(this.live.size>=nativeProcessLimits.active)throw Error('Active process limit reached');
    const id=randomUUID(),cwd=resolve(input.baseCwd??work.workingDirectory,input.cwd ?? '.');
    this.db.prepare("INSERT INTO native_processes (id,bot_id,work_kind,work_id,action_id,cwd,mode,state,created_ms) VALUES (?,?,?,?,?,?,?,'starting',?)").run(id,work.botId,work.work.kind,work.work.id,action.id,cwd,input.mode,Date.now());
    this.db.prepare('UPDATE native_processes SET retained=?,cols=?,rows=? WHERE id=?').run(input.retain?1:0,input.cols??null,input.rows??null,id);
    let done!:()=>void;const finished=new Promise<void>(resolve=>{done=resolve;});
    const filters=new Map<'stdout'|'stderr'|'terminal',ByteRedactor>();let flushed=false;
    const flush=()=>{if(flushed)return;flushed=true;for(const [stream,filter] of filters)this.append(id,stream,filter.finish());};
    const lifetime=work.workSignal??work.signal;
    const abort=()=>{this.stop(id);};let live!:Live;
    const observers:ProcessObservers={
      started:pid=>{this.db.prepare("UPDATE native_processes SET state=CASE WHEN stop_requested=1 THEN 'stopping' ELSE 'running' END,pid=? WHERE id=?").run(pid,id);if(lifetime.aborted || this.get(id)?.stopRequested)this.stop(id);},
      output:(stream,data)=>{const filter=filters.get(stream)??this.outputFilter();filters.set(stream,filter);this.append(id,stream,filter.write(data));},
      failed:()=>{this.db.prepare("UPDATE native_processes SET state='failed' WHERE id=?").run(id);},
      exited:(code,signal)=>{this.db.prepare("UPDATE native_processes SET exit_code=?,exit_signal=? WHERE id=?").run(code,signal,id);},
      lost:()=>{flush();if(live.timer)clearTimeout(live.timer);lifetime.removeEventListener('abort',abort);this.live.delete(id);this.db.prepare("UPDATE native_processes SET state='unknown' WHERE id=?").run(id);done();},
      closed:(code,signal)=>{flush();if(live.timer)clearTimeout(live.timer);lifetime.removeEventListener('abort',abort);this.live.delete(id);this.db.prepare("UPDATE native_processes SET state=CASE WHEN state='failed' THEN 'failed' ELSE 'exited' END,exit_code=?,exit_signal=?,output_complete=1 WHERE id=?").run(code,signal,id);done();},
    };
    let handle:ProcessHandle;
    try {handle=input.backend.launch(cwd,observers);} catch(error){this.db.prepare("UPDATE native_processes SET state='failed' WHERE id=?").run(id);throw error;}
    live={handle,signal:lifetime,abort,finished,done,flush};this.live.set(id,live);lifetime.addEventListener('abort',abort,{once:true});
    if(lifetime.aborted)this.stop(id);
    let timer:ReturnType<typeof setTimeout> | undefined;
    await Promise.race([finished,new Promise<void>(resolve=>{timer=setTimeout(resolve,nativeProcessLimits.settleMs);})]);if(timer)clearTimeout(timer);
    return this.get(id)!;
  }
  /** Only a live in-memory handle is returned; stored PIDs are never handles. */
  handle(id:string):ProcessHandle | undefined {return this.live.get(id)?.handle;}
  stopAgent(botId:string) {for(const id of this.live.keys())if(this.get(id)?.botId===botId)this.stop(id);}
  finishWork(work:WorkContext['work']) {if(this.closing)return;for(const record of this.forWork(work))if(record && !record.retained)this.stop(String(record.id));}
  private reserveInput(id:string,mode:unknown,used:number,bytes:number) {if(mode==='pty' && used+bytes>nativeProcessLimits.ptyInputBytes)throw new ActionFailed('PTY cumulative input budget reached; output and Stop remain available.');this.db.prepare('UPDATE native_processes SET input_bytes=input_bytes+? WHERE id=?').run(bytes,id);}
  async interact(id:string,operation:ProcessInteraction) {
    const queue=this.interactions.get(id)??{tail:Promise.resolve(),pending:0};
    if(queue.pending>=nativeProcessLimits.pendingInputs)throw new ActionFailed('Process input queue is full');
    const previous=queue.tail;let release!:()=>void;queue.tail=new Promise<void>(resolve=>{release=resolve;});queue.pending++;this.interactions.set(id,queue);
    try {await previous;const record=this.get(id),handle=this.handle(id);if(!record || !handle || record.stopRequested || !['starting','running'].includes(String(record.state)))throw new ActionFailed('Process has no writable live handle');
      if(operation.operation==='input'){if(record.inputClosed || !handle.write)throw new ActionFailed('Process input is closed');this.reserveInput(id,record.mode,Number(record.inputBytes),Buffer.byteLength(operation.data));await handle.write(Buffer.from(operation.data));return {processId:id,bytesSubmitted:Buffer.byteLength(operation.data),notice:'Input submitted; application receipt is not guaranteed.'};}
      if(operation.operation==='eof'){if(record.inputClosed || !handle.end)throw new ActionFailed('Process input is closed');this.reserveInput(id,record.mode,Number(record.inputBytes),record.mode==='pty'?1:0);await handle.end();if(record.mode==='pipe')this.db.prepare('UPDATE native_processes SET input_closed=1 WHERE id=?').run(id);return {processId:id,eofSent:true};}
      if(!handle.resize || record.mode!=='pty')throw new ActionFailed('Resize requires a PTY');handle.resize(operation.cols,operation.rows);this.db.prepare('UPDATE native_processes SET cols=?,rows=? WHERE id=?').run(operation.cols,operation.rows,id);return {processId:id,cols:operation.cols,rows:operation.rows};
    }finally{release();if(--queue.pending===0)this.interactions.delete(id);}
  }
  stop(id:string) {
    const record=this.get(id);if(!record)throw Error('Process not found');const live=this.live.get(id);
    if(!live) {if(record.state==='unknown')throw Error('Process observation lost; no live handle');return record;}
    if(record.state==='failed')return record;
    this.db.prepare("UPDATE native_processes SET stop_requested=1,state='stopping' WHERE id=?").run(id);
    const signal=(name:NodeJS.Signals)=>{if(this.live.has(id))live.handle.terminate(name);};
    signal('SIGTERM');if(!live.timer)live.timer=setTimeout(()=>signal('SIGKILL'),1000);
    return this.get(id)!;
  }
  async shutdown() {
    this.closing=true;for(const id of this.live.keys())this.stop(id);
    let timer:ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all([...this.live.values()].map(live=>live.finished)),new Promise(resolve=>{timer=setTimeout(resolve,nativeProcessLimits.shutdownMs);})]);
    if(timer)clearTimeout(timer);
    for(const [id,live] of this.live){if(live.timer)clearTimeout(live.timer);live.signal.removeEventListener('abort',live.abort);live.handle.detach();live.flush();this.db.prepare("UPDATE native_processes SET state='unknown' WHERE id=?").run(id);live.done();}
    this.live.clear();
  }
}
const dimensions=z.number().int().min(1).max(1000);
export const processInteraction=z.discriminatedUnion('operation',[z.strictObject({operation:z.literal('input'),data:z.string().refine(value=>Buffer.byteLength(value)<=nativeProcessLimits.inputBytes)}),z.strictObject({operation:z.literal('eof')}),z.strictObject({operation:z.literal('resize'),cols:dimensions,rows:dimensions})]);
export type ProcessInteraction=z.infer<typeof processInteraction>;
export function checkedInteraction(value:unknown,redact:(value:string)=>string):ProcessInteraction {const parsed=processInteraction.parse(value);if(parsed.operation==='input' && redact(parsed.data)!==parsed.data)throw new ActionFailed('Terminal input cannot be retained faithfully under the instance redaction rules.');return parsed;}
const input=z.strictObject({command:z.string().min(1).max(32000).refine(value=>!value.includes('\0') && Buffer.byteLength(value)<=32000),cwd:z.string().min(1).refine(value=>!value.includes('\0') && Buffer.byteLength(value)<=4096).optional(),mode:z.enum(['pipe','pty']).optional(),retain:z.boolean().optional(),cols:dimensions.optional(),rows:dimensions.optional()});
export function nativeCommandCapability(manager:NativeProcesses, allowed:(work:WorkContext)=>boolean,redact:(value:string)=>string,start:(work:WorkContext,action:ActionIdentity,value:z.infer<typeof input>)=>Promise<unknown>,canonicalCwd?:(cwd:string|undefined,work:WorkContext)=>string):Capability<z.infer<typeof input>,unknown> {
  const identity=(value:z.infer<typeof input>,work:WorkContext)=>{const mode=value.mode??'pipe';return JSON.stringify([value.command,canonicalCwd?canonicalCwd(value.cwd,work):resolve(work.workingDirectory,value.cwd??'.'),mode,value.retain??false,mode==='pty'?value.cols??80:null,mode==='pty'?value.rows??24:null]);};
  return {name:'terminal_run',sameAction:(previous,next,work)=>identity(previous,work)===identity(next,work),definition:{type:'function',function:{name:'terminal_run',description:'Run ordinary host shell text. Set mode pty for a terminal and retain true to keep the process after work completes. Returns process ID/status; read output separately.',parameters:{type:'object',properties:{command:{type:'string'},cwd:{type:'string'},mode:{type:'string',enum:['pipe','pty']},retain:{type:'boolean'},cols:{type:'integer'},rows:{type:'integer'}},required:['command'],additionalProperties:false}}},parseInput:value=>{const parsed=input.parse(value);for(const text of [parsed.command,parsed.cwd])if(text!==undefined && redact(text)!==text)throw new ActionFailed('Terminal input cannot be retained faithfully under the instance redaction rules.');return parsed;},parseResult:value=>value,describe:()=>({summary:'Run host command',resource:'host',effect:'change',opaque:true}),eligible:allowed,check:(_value,work)=>{if(!allowed(work))throw Error('Process work is no longer authorized');},authorize:async()=>{},execute:(value,work,action)=>start(work,action,value),visibleResult:value=>JSON.stringify(value),recovery:{reconcile:(_value,evidence,work,action)=>manager.reconcileRun(work,action,evidence)}};
}

const processReadInput=z.strictObject({processId:z.string().uuid(),cursor:z.number().int().nonnegative().optional()});
export function nativeOutputCapability(manager:NativeProcesses, allowed:(work:WorkContext)=>boolean):Capability<z.infer<typeof processReadInput>,unknown> {
  return {name:'terminal_read',definition:{type:'function',function:{name:'terminal_read',description:'Read credential-filtered process output as base64 stream chunks with optional UTF-8 text, a cursor and explicit gap.',parameters:{type:'object',properties:{processId:{type:'string'},cursor:{type:'integer'}},required:['processId'],additionalProperties:false}}},parseInput:value=>processReadInput.parse(value),parseResult:value=>value,describe:value=>({summary:'Read process output',resource:value.processId,effect:'read'}),eligible:allowed,check:(value,work)=>{if(!allowed(work) || manager.get(value.processId)?.botId!==work.botId)throw Error('Process unavailable');},authorize:async()=>{},execute:async value=>manager.output(value.processId,value.cursor),visibleResult:value=>JSON.stringify(value)};
}

const processStopInput=z.strictObject({processId:z.string().uuid()});
export function nativeStopCapability(manager:NativeProcesses, allowed:(work:WorkContext)=>boolean):Capability<z.infer<typeof processStopInput>,unknown> {
  return {name:'terminal_stop',definition:{type:'function',function:{name:'terminal_stop',description:'Request termination of an owned process; exited is reported only when observed.',parameters:{type:'object',properties:{processId:{type:'string'}},required:['processId'],additionalProperties:false}}},parseInput:value=>processStopInput.parse(value),parseResult:value=>value,describe:value=>({summary:'Stop host process',resource:value.processId,effect:'change',opaque:true}),eligible:allowed,check:(value,work)=>{if(!allowed(work) || manager.get(value.processId)?.botId!==work.botId)throw Error('Process unavailable');},authorize:async()=>{},execute:async value=>manager.stop(value.processId),visibleResult:value=>JSON.stringify(value)};
}

/** Interaction is a changing action; recovery never silently resubmits input. */
export function nativeInteractionCapabilities(manager:NativeProcesses,allowed:(work:WorkContext)=>boolean,redact:(value:string)=>string) {
 const processId=z.string().uuid();
 const common={processId:{type:'string' as const}};
 function capability<I extends {processId:string}>(name:string,schema:z.ZodType<I>,properties:Record<string,import('./types.js').ToolParameter>,required:string[],operation:(value:I)=>ProcessInteraction):Capability<I,unknown> {
  return {name,definition:{type:'function',function:{name,description:'Interact with an owned live process. Input is submitted once; results do not prove application receipt.',parameters:{type:'object',properties,required,additionalProperties:false}}},parseInput:value=>{const parsed=schema.parse(value);checkedInteraction(operation(parsed),redact);return parsed;},parseResult:value=>value,describe:value=>({summary:name,resource:value.processId,effect:'change',opaque:true}),eligible:allowed,check:(value,work)=>{if(!allowed(work)||manager.get(value.processId)?.botId!==work.botId)throw Error('Process unavailable');},authorize:async()=>{},execute:(value)=>manager.interact(value.processId,operation(value)),visibleResult:value=>JSON.stringify(value)};
 }
 return {
  write:capability('terminal_write',z.strictObject({processId,data:z.string().refine(value=>Buffer.byteLength(value)<=nativeProcessLimits.inputBytes)}),{...common,data:{type:'string'}},['processId','data'],value=>({operation:'input',data:value.data})),
  eof:capability('terminal_eof',z.strictObject({processId}),common,['processId'],()=>({operation:'eof'})),
  resize:capability('terminal_resize',z.strictObject({processId,cols:dimensions,rows:dimensions}),{...common,cols:{type:'integer'},rows:{type:'integer'}},['processId','cols','rows'],value=>({operation:'resize',cols:value.cols,rows:value.rows}))
 };
}
