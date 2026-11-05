import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Capability, WorkContext, ActionIdentity } from './work-actions.js';

export const nativeProcessSchema = `
CREATE TABLE IF NOT EXISTS native_processes (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, work_kind TEXT NOT NULL, work_id TEXT NOT NULL, action_id TEXT NOT NULL REFERENCES action_journal(id), cwd TEXT NOT NULL, mode TEXT NOT NULL, state TEXT NOT NULL, pid INTEGER, exit_code INTEGER, exit_signal TEXT, stop_requested INTEGER NOT NULL DEFAULT 0, output_complete INTEGER NOT NULL DEFAULT 0, next_cursor INTEGER NOT NULL DEFAULT 0, first_cursor INTEGER NOT NULL DEFAULT 0, created_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS native_process_output (process_id TEXT NOT NULL REFERENCES native_processes(id), cursor INTEGER NOT NULL, stream TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(process_id,cursor));
`;
export const nativeProcessLimits = Object.freeze({active:16, outputBytes:128*1024, pageBytes:48*1024, settleMs:200, shutdownMs:3000});
export type ProcessObservers = {started:(pid:number|null)=>void;output:(stream:'stdout'|'stderr'|'terminal',data:Buffer)=>void;failed:()=>void;exited:(code:number|null,signal:string|null)=>void;closed:(code:number|null,signal:string|null)=>void};
export type ProcessHandle = {terminate:(signal:NodeJS.Signals)=>void;detach:()=>void};
/** Backends deliver observations asynchronously after launch returns. */
export type ProcessBackend = {launch:(cwd:string,observers:ProcessObservers)=>ProcessHandle};
type Live = {handle:ProcessHandle; signal:AbortSignal; abort:()=>void; timer?:ReturnType<typeof setTimeout>; finished:Promise<void>; done:()=>void};

function pipeBackend(command:string):ProcessBackend {
  return {launch:(cwd,observers)=>{
    const child=spawn(process.env.SHELL || '/bin/sh',['-c',command],{cwd,env:process.env,detached:true,stdio:['ignore','pipe','pipe']});
    child.stdout?.on('data',(data:Buffer)=>observers.output('stdout',data));child.stderr?.on('data',(data:Buffer)=>observers.output('stderr',data));
    child.once('spawn',()=>observers.started(child.pid ?? null));child.once('error',()=>observers.failed());child.once('exit',(code,signal)=>observers.exited(code,signal));child.once('close',(code,signal)=>observers.closed(code,signal));
    return {terminate:signal=>{if(!child.pid || child.exitCode!==null || child.signalCode!==null)return;try{process.kill(-child.pid,signal);}catch{try{child.kill(signal);}catch{/* no observed exit */}}},detach:()=>{child.removeAllListeners();child.on('error',()=>{});child.stdout?.removeAllListeners();child.stderr?.removeAllListeners();}};
  }};
}

/** Owns pipe processes and their observations. A later PTY backend must use the same ownership and lifecycle. */
export class NativeProcesses {
  private readonly live=new Map<string,Live>();
  private closing=false;
  constructor(private readonly db:DatabaseSync) {
    db.exec("UPDATE native_processes SET state='unknown' WHERE state IN ('starting','running','stopping')");
  }
  list() {return this.db.prepare('SELECT id FROM native_processes ORDER BY created_ms DESC, rowid DESC LIMIT 200').all().map(row=>this.get(String(row.id)));}
  forWork(work:WorkContext['work']) {return this.db.prepare('SELECT id FROM native_processes WHERE work_kind=? AND work_id=? ORDER BY created_ms').all(work.kind,work.id).map(row=>this.get(String(row.id)));}
  get(id:string) {
    const row=this.db.prepare('SELECT * FROM native_processes WHERE id=?').get(id);if(!row)return null;
    return {id:row.id,botId:row.bot_id,work:{kind:row.work_kind,id:row.work_id},actionId:row.action_id,cwd:row.cwd,mode:row.mode,state:row.state,pid:row.pid,exitCode:row.exit_code,exitSignal:row.exit_signal,stopRequested:row.stop_requested===1,outputComplete:row.output_complete===1,firstCursor:row.first_cursor,nextCursor:row.next_cursor,limits:nativeProcessLimits};
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
      const data=Buffer.from(row.data as Uint8Array);if(bytes+data.length>nativeProcessLimits.pageBytes)break;
      bytes+=data.length;pageNext=Number(row.cursor)+1;
      let text:string|null=null;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{/* Base64 preserves bytes that are not a complete UTF-8 chunk. */}
      chunks.push({cursor:row.cursor,stream:row.stream,data:data.toString('base64'),text});
    }
    return {processId:id,process,encoding:'base64',gap:cursor<first,firstCursor:first,nextCursor:pageNext,observedCursor:next,hasMore:pageNext<next,chunks,limits:nativeProcessLimits};
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
  start(work:WorkContext,action:ActionIdentity,input:{command:string;cwd?:string}) {
    return this.startBackend(work,action,{cwd:input.cwd,mode:'pipe',backend:pipeBackend(input.command)});
  }
  /** Register ownership before launch; #85 can supply a PTY backend through this seam. */
  async startBackend(work:WorkContext,action:ActionIdentity,input:{cwd?:string;mode:string;backend:ProcessBackend}) {
    if(this.closing)throw Error('Process admission closed');
    work.signal.throwIfAborted();if(this.live.size>=nativeProcessLimits.active)throw Error('Active process limit reached');
    const id=randomUUID(),cwd=resolve(work.workingDirectory,input.cwd ?? '.');
    this.db.prepare("INSERT INTO native_processes (id,bot_id,work_kind,work_id,action_id,cwd,mode,state,created_ms) VALUES (?,?,?,?,?,?,?,'starting',?)").run(id,work.botId,work.work.kind,work.work.id,action.id,cwd,input.mode,Date.now());
    let done!:()=>void;const finished=new Promise<void>(resolve=>{done=resolve;});
    const abort=()=>{this.stop(id);};let live!:Live;
    const observers:ProcessObservers={
      started:pid=>{this.db.prepare("UPDATE native_processes SET state=CASE WHEN stop_requested=1 THEN 'stopping' ELSE 'running' END,pid=? WHERE id=?").run(pid,id);if(work.signal.aborted || this.get(id)?.stopRequested)this.stop(id);},
      output:(stream,data)=>this.append(id,stream,data),
      failed:()=>{this.db.prepare("UPDATE native_processes SET state='failed' WHERE id=? AND pid IS NULL").run(id);},
      exited:(code,signal)=>{this.db.prepare("UPDATE native_processes SET state='exited',exit_code=?,exit_signal=? WHERE id=?").run(code,signal,id);},
      closed:(code,signal)=>{if(live.timer)clearTimeout(live.timer);work.signal.removeEventListener('abort',abort);this.live.delete(id);this.db.prepare("UPDATE native_processes SET state=CASE WHEN state='failed' THEN 'failed' ELSE 'exited' END,exit_code=?,exit_signal=?,output_complete=1 WHERE id=?").run(code,signal,id);done();},
    };
    let handle:ProcessHandle;
    try {handle=input.backend.launch(cwd,observers);} catch(error){this.db.prepare("UPDATE native_processes SET state='failed' WHERE id=?").run(id);throw error;}
    live={handle,signal:work.signal,abort,finished,done};this.live.set(id,live);work.signal.addEventListener('abort',abort,{once:true});
    if(work.signal.aborted)this.stop(id);
    let timer:ReturnType<typeof setTimeout> | undefined;
    await Promise.race([finished,new Promise<void>(resolve=>{timer=setTimeout(resolve,nativeProcessLimits.settleMs);})]);if(timer)clearTimeout(timer);
    return this.get(id)!;
  }
  /** Only a live in-memory handle is returned; stored PIDs are never handles. */
  handle(id:string):ProcessHandle | undefined {return this.live.get(id)?.handle;}
  stop(id:string) {
    const record=this.get(id);if(!record)throw Error('Process not found');const live=this.live.get(id);
    if(!live) {if(record.state==='unknown')throw Error('Process observation lost; no live handle');return record;}
    if(record.state==='exited' || record.state==='failed')return record;
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
    for(const [id,live] of this.live){if(live.timer)clearTimeout(live.timer);live.signal.removeEventListener('abort',live.abort);live.handle.detach();this.db.prepare("UPDATE native_processes SET state=CASE WHEN state='exited' THEN state ELSE 'unknown' END WHERE id=?").run(id);live.done();}
    this.live.clear();
  }
}
const input=z.strictObject({command:z.string().min(1).max(32000).refine(value=>!value.includes('\0')),cwd:z.string().min(1).optional()});
export function nativeCommandCapability(manager:NativeProcesses, allowed:(work:WorkContext)=>boolean):Capability<z.infer<typeof input>,unknown> {
  return {name:'terminal_run',definition:{type:'function',function:{name:'terminal_run',description:'Run ordinary host shell text. Returns observed process state and ID; inspect output separately.',parameters:{type:'object',properties:{command:{type:'string'},cwd:{type:'string'}},required:['command'],additionalProperties:false}}},parseInput:value=>input.parse(value),parseResult:value=>value,describe:()=>({summary:'Run host command',resource:'host',effect:'change',opaque:true}),eligible:allowed,check:(_value,work)=>{if(!allowed(work))throw Error('Process work is no longer authorized');},authorize:async()=>{},execute:(value,work,action)=>manager.start(work,action,value),visibleResult:value=>JSON.stringify(value)};
}

const processReadInput=z.strictObject({processId:z.string().uuid(),cursor:z.number().int().nonnegative().optional()});
export function nativeOutputCapability(manager:NativeProcesses, allowed:(work:WorkContext)=>boolean):Capability<z.infer<typeof processReadInput>,unknown> {
  return {name:'terminal_read',definition:{type:'function',function:{name:'terminal_read',description:'Read observed process output as base64 stream chunks with optional UTF-8 text, a cursor and explicit gap.',parameters:{type:'object',properties:{processId:{type:'string'},cursor:{type:'integer'}},required:['processId'],additionalProperties:false}}},parseInput:value=>processReadInput.parse(value),parseResult:value=>value,describe:value=>({summary:'Read process output',resource:value.processId,effect:'read'}),eligible:allowed,check:(value,work)=>{if(!allowed(work) || manager.get(value.processId)?.botId!==work.botId)throw Error('Process unavailable');},authorize:async()=>{},execute:async value=>manager.output(value.processId,value.cursor),visibleResult:value=>JSON.stringify(value)};
}

const processStopInput=z.strictObject({processId:z.string().uuid()});
export function nativeStopCapability(manager:NativeProcesses, allowed:(work:WorkContext)=>boolean):Capability<z.infer<typeof processStopInput>,unknown> {
  return {name:'terminal_stop',definition:{type:'function',function:{name:'terminal_stop',description:'Request termination of an owned process; exited is reported only when observed.',parameters:{type:'object',properties:{processId:{type:'string'}},required:['processId'],additionalProperties:false}}},parseInput:value=>processStopInput.parse(value),parseResult:value=>value,describe:value=>({summary:'Stop host process',resource:value.processId,effect:'change',opaque:true}),eligible:allowed,check:(value,work)=>{if(!allowed(work) || manager.get(value.processId)?.botId!==work.botId)throw Error('Process unavailable');},authorize:async()=>{},execute:async value=>manager.stop(value.processId),visibleResult:value=>JSON.stringify(value)};
}
