import {ActionFailed} from './work-actions.js';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {z} from 'zod';

const workspace='/srv/staf-workspace';
const policyPath='/etc/staf-exec/host.json';
const sudo='/usr/bin/sudo',launcher='/usr/lib/staf-exec/launch',guard='/usr/lib/staf-exec/staf-exec-guard',bwrap='/usr/bin/bwrap',node='/usr/bin/node',fileWorker='/usr/lib/staf-exec/staf-file-worker.mjs',fileOpen='/usr/lib/staf-exec/staf-file-open';
export const bundledLauncherHash='e84982993c408c55a6714a3be70ef84fc759b586da29aebe015f2297ea62d2d3';
export const bundledFileWorkerHash='26d696f65057bf9f4c2845999f1a4a4d9971376603e09d61f2e911c1245de7e9';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const policySchema=z.strictObject({version:z.literal(1),workspace:z.literal(workspace),serviceUid:z.number().int().positive(),executionUid:z.number().int().positive(),executionGid:z.number().int().positive(),launcherSha256:digest,guardSha256:digest,bwrapSha256:digest,sudoSha256:digest,nodeSha256:digest,fileWorkerSha256:digest,fileOpenSha256:digest});

/** Policy and every ancestor are root-owned and cannot be replaced by either account. */
function trustedPath(path:string,kind:'file'|'directory',writableLeaf=false):void {
 if(!isAbsolute(path) || resolve(path)!==path || realpathSync(path)!==path)throw Error('Untrusted isolation path');
 let current=path;
 for(;;) {
  const stat=lstatSync(current),leaf=current===path;
  if(stat.isSymbolicLink() || stat.uid!==0 || (!leaf || !writableLeaf) && (stat.mode&0o022)!==0 || (leaf && (kind==='file'?!stat.isFile():!stat.isDirectory())))throw Error('Untrusted isolation path');
  const parent=dirname(current);if(parent===current)break;current=parent;
 }
}
function checkedHash(path:string,expected:string):void {
 trustedPath(path,'file');if(createHash('sha256').update(readFileSync(path)).digest('hex')!==expected)throw Error('Isolation executable changed');
}
function id(args:string[]):string {
 const result=spawnSync('/usr/bin/id',args,{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:2000,maxBuffer:4096});
 if(result.status!==0 || !/^\d+(?: \d+)*\n?$/.test(result.stdout))throw Error('Isolation identity unavailable');
 return result.stdout.trim();
}
function nearestExisting(path:string):string {
 let current=resolve(path);
 for(;;){try{return realpathSync(current);}catch(error){if(!(error instanceof Error && 'code' in error && error.code==='ENOENT'))throw error;const parent=dirname(current);if(parent===current)throw error;current=parent;}}
}

export function isolatedWorkingDirectory(root:string,path:string):string {
 const base=resolve(root),target=resolve(path),visibleRoot='/workspace';
 const visiblePart=relative(visibleRoot,target);
 const part=visiblePart!=='..' && !visiblePart.startsWith('..'+sep) && !isAbsolute(visiblePart)?visiblePart:relative(base,target);
 if(part==='..' || part.startsWith('..'+sep) || isAbsolute(part))throw new ActionFailed('Working directory is outside the approved workspace');
 return part || '.';
}
export function isolatedVisiblePath(root:string,path:string):string {
 return resolve('/workspace',isolatedWorkingDirectory(root,path));
}

export type LinuxHostBoundary={workspace:string;recheck:()=>void};
/** Explicit selection is never a fallback: failed checks leave the capability unavailable. */
export function selectLinuxHostBoundary(input:{enabled:boolean;dataDir:string;secretDir:string}):LinuxHostBoundary|null {
 if(!input.enabled || process.platform!=='linux')return null;
 const recheck=()=>{
  trustedPath(policyPath,'file');const policy=policySchema.parse(JSON.parse(readFileSync(policyPath,'utf8')));
  if(policy.serviceUid===policy.executionUid || policy.executionUid===65534 || policy.executionGid===65534 || process.getuid?.()!==policy.serviceUid || process.geteuid?.()!==policy.serviceUid || !process.getgroups || process.getgroups().includes(policy.executionGid) || policy.launcherSha256!==bundledLauncherHash || policy.fileWorkerSha256!==bundledFileWorkerHash)throw Error('Isolation identity mismatch');
  trustedPath('/usr/bin/id','file');trustedPath('/usr/sbin/getcap','file');trustedPath('/usr/bin/getfacl','file');
  if(id(['-u','staf-service'])!==String(policy.serviceUid) || id(['-u','staf-exec'])!==String(policy.executionUid) || id(['-g','staf-exec'])!==String(policy.executionGid) || id(['-G','staf-exec'])!==String(policy.executionGid) || id(['-G','staf-service']).split(' ').includes(String(policy.executionGid)))throw Error('Isolation account mismatch');
  checkedHash(sudo,policy.sudoSha256);checkedHash(launcher,policy.launcherSha256);checkedHash(guard,policy.guardSha256);checkedHash(bwrap,policy.bwrapSha256);checkedHash(node,policy.nodeSha256);checkedHash(fileWorker,policy.fileWorkerSha256);checkedHash(fileOpen,policy.fileOpenSha256);
  const bwrapStat=lstatSync(bwrap);if((bwrapStat.mode&0o6000)!==0)throw Error('Privileged bubblewrap is unavailable');
  const caps=spawnSync('/usr/sbin/getcap',[bwrap],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:2000,maxBuffer:4096});if(caps.status!==0 || caps.stdout.trim())throw Error('Bubblewrap file capabilities are unavailable');
  trustedPath(workspace,'directory',true);const ws=statSync(workspace);
  if(ws.gid!==policy.executionGid || (ws.mode&0o777)!==0o770)throw Error('Workspace permissions unavailable');
  const acl=spawnSync('/usr/bin/getfacl',['-cp',workspace],{env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},encoding:'utf8',timeout:2000,maxBuffer:4096});
  if(acl.status!==0 || acl.stdout.trim()!=='user::rwx\ngroup::rwx\nother::---')throw Error('Workspace ACL unavailable');
  for(const root of [input.dataDir,input.secretDir,resolve(input.dataDir,'auth'),resolve(input.secretDir,'secrets'),'/usr']) {
   const path=nearestExisting(root),inside=relative('/usr',path);if((inside==='' || (!inside.startsWith('..'+sep) && inside!=='..' && !isAbsolute(inside))) && root!=='/usr')throw Error('Credential storage is in the runtime mount');
   if(statSync(path).dev===ws.dev)throw Error('Workspace must use a separate filesystem');
  }
 };
 try {recheck();return {workspace,recheck};}catch{return null;}
}

const readyLines=[Buffer.from('STAF-EXEC-READY-1\n'),Buffer.from('STAF-EXEC-READY-1\r\n')];
type GuardCallbacks={cwd:string;command:string;send:(data:Buffer)=>void;started:()=>void;output:(data:Buffer)=>void;failed:()=>void};

/** No command or input is submitted until the fixed guard reports readiness. */
export class GuardHandshake {
 private state:'waiting'|'ready'|'failed'='waiting';
 private pending=Buffer.alloc(0);
 constructor(private readonly callbacks:GuardCallbacks) {
  if(!callbacks.cwd || Buffer.byteLength(callbacks.cwd)>4096 || callbacks.cwd.includes('\0') || !callbacks.command || Buffer.byteLength(callbacks.command)>32000 || callbacks.command.includes('\0'))throw new ActionFailed('Invalid isolated process request');
 }
 receive(data:Buffer):void {
  if(this.state==='failed')return;
  if(this.state==='ready'){this.callbacks.output(data);return;}
  this.pending=Buffer.concat([this.pending,data]);
  const complete=readyLines.find(line=>this.pending.length>=line.length && this.pending.subarray(0,line.length).equals(line));
  if(complete) {
   const rest=this.pending.subarray(complete.length);this.pending=Buffer.alloc(0);
   try {
    this.callbacks.send(Buffer.from(Buffer.from(this.callbacks.cwd).toString('base64')+'\n'+Buffer.from(this.callbacks.command).toString('base64')+'\n'));
    this.state='ready';this.callbacks.started();if(rest.length)this.callbacks.output(rest);
   } catch {this.fail();}
   return;
  }
  if(!readyLines.some(line=>this.pending.length<line.length && line.subarray(0,this.pending.length).equals(this.pending)))this.fail();
 }
 fail():void {if(this.state==='failed')return;this.state='failed';this.pending=Buffer.alloc(0);this.callbacks.failed();}
}
