import {spawn} from 'node:child_process';
import type {IPty} from 'node-pty';
import {GuardHandshake,isolatedWorkingDirectory,type LinuxHostBoundary} from './linux-host-boundary.js';
import {ActionFailed} from './work-actions.js';
import type {ProcessBackend} from './native-processes.js';

const program='/usr/bin/sudo';
const args=['-n','-u','staf-exec','-g','staf-exec','--','/usr/lib/staf-exec/launch'];
const environment={PATH:'/usr/bin:/bin',HOME:'/nonexistent',TERM:'xterm-256color'};
const notReady=()=>new ActionFailed('Isolated process is not ready');

/** Only the operator's fixed launcher is invoked. Commands travel after its guard handshake. */
export function linuxHostProcessBackend(boundary:LinuxHostBoundary,command:string,mode:'pipe'|'pty',cols:number,rows:number):ProcessBackend {
 return {launch:(cwd,observers)=>{
  try {boundary.recheck();}catch {throw new ActionFailed('Linux host isolation is unavailable');}
  const isolatedCwd=isolatedWorkingDirectory(boundary.workspace,cwd);
  if(Buffer.byteLength(isolatedCwd)>4096 || !command || command.includes('\0') || Buffer.byteLength(command)>32000)throw new ActionFailed('Invalid isolated process request');
  let ready=false,failed=false,detached=false,finished=false,cancelled=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const markFailed=()=>{if(failed || finished)return;failed=true;if(timer)clearTimeout(timer);if(!detached)observers.failed();};
  const markStarted=(pid:number|null)=>{ready=true;if(timer)clearTimeout(timer);if(!detached)observers.started(pid);};
  const close=(code:number|null,signal:string|null)=>{if(finished)return;if(!ready)markFailed();finished=true;if(timer)clearTimeout(timer);if(!detached){observers.exited(code,signal);observers.closed(code,signal);}};
  if(mode==='pipe') {
   const child=spawn(program,args,{cwd:'/',env:environment,detached:true,stdio:['pipe','pipe','pipe']});
   child.stdin.on('error',()=>{});
   const protocol=new GuardHandshake({cwd:isolatedCwd,command,send:data=>{if(cancelled || !child.stdin.writable)throw notReady();child.stdin.write(data);},started:()=>markStarted(child.pid??null),output:data=>{if(!detached)observers.output('stdout',data);},failed:()=>{markFailed();child.kill('SIGKILL');}});
   child.stdout.on('data',(data:Buffer)=>protocol.receive(data));child.stderr.on('data',(data:Buffer)=>{if(ready&&!detached)observers.output('stderr',data);});
   child.once('error',()=>{markFailed();});child.once('close',(code,signal)=>close(code,signal));
   timer=setTimeout(()=>protocol.fail(),5000);
   return {terminate:signal=>{cancelled=true;if(!ready){protocol.fail();return;}if(child.exitCode===null && child.signalCode===null)child.kill(signal);},write:data=>new Promise<void>((resolve,reject)=>{if(cancelled || !ready || !child.stdin.writable){reject(notReady());return;}child.stdin.write(data,error=>error?reject(error):resolve());}),end:()=>new Promise<void>((resolve,reject)=>{if(cancelled || !ready || !child.stdin.writable){reject(notReady());return;}child.stdin.end(resolve);}),detach:()=>{detached=true;if(timer)clearTimeout(timer);child.stdout.removeAllListeners('data');child.stderr.removeAllListeners('data');}};
  }
  let terminal:IPty|undefined;
  const protocol=new GuardHandshake({cwd:isolatedCwd,command,send:data=>{if(cancelled || !terminal)throw notReady();terminal.write(data);},started:()=>markStarted(terminal?.pid??null),output:data=>{if(!detached)observers.output('terminal',data);},failed:()=>{markFailed();terminal?.kill('SIGKILL');}});
  timer=setTimeout(()=>protocol.fail(),5000);
  void import('node-pty').then(({spawn:spawnPty})=>{
   if(detached || failed)return;
   terminal=spawnPty(program,args,{cwd:'/',env:environment,name:'xterm-256color',cols,rows,encoding:null});
   terminal.onData((data:unknown)=>{if(Buffer.isBuffer(data))protocol.receive(data);else if(typeof data==='string')protocol.receive(Buffer.from(data));});
   terminal.onExit(event=>close(event.exitCode,event.signal?String(event.signal):null));
  }).catch(()=>{markFailed();close(null,null);});
  return {terminate:signal=>{cancelled=true;if(!ready){protocol.fail();if(!terminal)close(null,null);return;}terminal?.kill(signal);},write:async data=>{if(cancelled || !ready || !terminal)throw notReady();terminal.write(data);},end:async()=>{if(cancelled || !ready || !terminal)throw notReady();terminal.write('\x04');},resize:(width,height)=>{if(cancelled || !ready || !terminal)throw notReady();terminal.resize(width,height);},detach:()=>{detached=true;if(timer)clearTimeout(timer);}};
 }};
}
