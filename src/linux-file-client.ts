import {z} from 'zod';
import {jsonValue,type Json} from './code-mode/json.js';
import {linuxHostProcessBackend} from './linux-host-process.js';
import type {LinuxHostBoundary} from './linux-host-boundary.js';

const response=z.strictObject({ok:z.literal(true),result:jsonValue});
const fileCommand='/usr/lib/staf-exec/staf-file-open';
const envelope=z.object({kind:z.enum(['read','write','edit','search','verify']),path:z.string().min(1).max(4096)}).passthrough();

/** Raw worker output stays in service memory until the caller validates it. */
export function isolatedFileRequest(boundary:LinuxHostBoundary,request:Json,signal:AbortSignal):Promise<Json> {
 signal.throwIfAborted();const parsed=envelope.parse(request),input=Buffer.from(Buffer.from(parsed.path).toString('base64')+'\n'+parsed.kind+'\n'+JSON.stringify(request));if(input.length>1048576)throw Error('File request is too large');
 return new Promise((resolve,reject)=>{
  let settled=false,started=false,size=0;const chunks:Buffer[]=[];
  const finish=(error:Error|undefined,result?:Json)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(error)reject(error);else if(result!==undefined)resolve(result);else reject(Error('File worker failed'));};
  const terminate=()=>{try{handle.terminate('SIGKILL');}catch{/* The process may already have exited. */}};
  const abort=()=>{terminate();finish(Error('File operation interrupted'));};
  const timer=setTimeout(()=>{terminate();finish(Error('File worker timed out'));},10000);
  let handle:ReturnType<ReturnType<typeof linuxHostProcessBackend>['launch']>;
  try {
   handle=linuxHostProcessBackend(boundary,fileCommand,'pipe',80,24).launch(boundary.workspace,{
    started:()=>{started=true;if(signal.aborted){abort();return;}void handle.write?.(input).then(()=>handle.end?.()).catch(()=>{terminate();finish(Error('File worker input failed'));});},
    output:(stream,data)=>{if(stream!=='stdout' || settled)return;size+=data.length;if(size>512*1024){terminate();finish(Error('File worker output exceeded its bound'));return;}chunks.push(data);},
    failed:()=>finish(Error('File worker boundary unavailable')),
    exited:()=>{},lost:()=>finish(Error('File worker observation lost')),
    closed:(code)=>{if(!started || code!==0){finish(Error('File worker failed'));return;}try{const parsed=response.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));finish(undefined,parsed.result);}catch{finish(Error('File worker result invalid'));}},
   });
   signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  } catch(error){clearTimeout(timer);signal.removeEventListener('abort',abort);reject(error);}
 });
}
