import {createServer, type Socket} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import type {IPty} from 'node-pty';
import {z} from 'zod';
import type {ProcessBackend} from './native-processes.js';
import {ActionFailed} from './work-actions.js';

const observation=z.discriminatedUnion('type',[
 z.object({type:z.literal('ready'),token:z.string()}),z.object({type:z.literal('closed')}),z.object({type:z.literal('failed')}),
 z.object({type:z.literal('exited'),code:z.number().int().nullable(),signal:z.string().nullable()})
]);

/** The PTY child is a live group leader; termination goes over its private socket. */
export function ptyBackend(command:string,cols:number,rows:number):ProcessBackend {
 return {launch:(cwd,observers)=>{
  const directory=mkdtempSync('/tmp/staf-pty-'),path=join(directory,'control'),token=randomUUID();
  let terminal:IPty|undefined,channel:Socket|undefined,authenticated=false,settled=false,detached=false,exitCode:number|null=null,exitSignal:string|null=null;
  const signals:NodeJS.Signals[]=[];const connections=new Set<Socket>();
  const cleanup=(finish:()=>void)=>{for(const socket of connections)socket.destroy();server.close(()=>{rmSync(directory,{recursive:true,force:true});if(!detached)finish();});};
  const server=createServer(socket=>{
   connections.add(socket);socket.setEncoding('utf8');let pending='';
   socket.on('error',()=>{});socket.on('data',text=>{pending+=text;if(pending.length>4096){socket.destroy();return;}for(let at=pending.indexOf('\n');at>=0;at=pending.indexOf('\n')){const line=pending.slice(0,at);pending=pending.slice(at+1);let value:unknown;try{value=JSON.parse(line);}catch{socket.destroy();return;}const parsed=observation.safeParse(value);if(!parsed.success){socket.destroy();return;}const event=parsed.data;
    if(!authenticated){if(event.type!=='ready'||event.token!==token){socket.destroy();return;}authenticated=true;channel=socket;for(const signal of signals)socket.write(JSON.stringify(signal)+'\n');signals.length=0;observers.started(terminal?.pid??null);continue;}
    if(socket!==channel){socket.destroy();return;}if(event.type==='exited'){exitCode=event.code;exitSignal=event.signal;observers.exited(exitCode,exitSignal);}else if(event.type==='closed')settled=true;else if(event.type==='failed')observers.failed();
   }});
  });
  server.once('error',()=>{observers.failed();cleanup(()=>observers.closed(null,null));});
  server.listen(path,()=>{void import('node-pty').then(({spawn})=>{
   if(detached)return;terminal=spawn(process.execPath,[fileURLToPath(new URL('./native-process-supervisor.js',import.meta.url)),command],{cwd,env:{...process.env,STAF_NATIVE_PTY_SOCKET:path,STAF_NATIVE_PTY_TOKEN:token},name:'xterm-256color',cols,rows,encoding:null});
   terminal.onData((data:unknown)=>{if(!detached){if(Buffer.isBuffer(data))observers.output('terminal',data);else if(typeof data==='string')observers.output('terminal',Buffer.from(data));}});
   terminal.onExit(()=>cleanup(()=>settled?observers.closed(exitCode,exitSignal):observers.lost()));
  }).catch(()=>{observers.failed();cleanup(()=>observers.closed(null,null));});});
  return {terminate:signal=>{if(channel?.writable)channel.write(JSON.stringify(signal)+'\n');else signals.push(signal);},write:async data=>{if(!terminal||!authenticated)throw new ActionFailed('Terminal is not ready; inspect its state before submitting input.');terminal.write(data);},end:async()=>{if(!terminal||!authenticated)throw new ActionFailed('Terminal is not ready; inspect its state before submitting input.');terminal.write('\x04');},resize:(cols,rows)=>{if(!terminal||!authenticated)throw new ActionFailed('Terminal is not ready; inspect its state before submitting input.');terminal.resize(cols,rows);},detach:()=>{detached=true;cleanup(()=>{});}};
 }};
}
