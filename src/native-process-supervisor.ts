import { spawn } from 'node:child_process';
import { connect } from 'node:net';

const socketPath=process.env.STAF_NATIVE_PTY_SOCKET,token=process.env.STAF_NATIVE_PTY_TOKEN;
delete process.env.STAF_NATIVE_PTY_SOCKET;delete process.env.STAF_NATIVE_PTY_TOKEN;
const channel=socketPath?connect(socketPath):undefined;
const send=(value:object,done:()=>void=()=>{})=>{if(channel)channel.write(JSON.stringify(value)+'\n',done);else process.send?.(value,done);};
if(channel){channel.once('connect',()=>send({type:'ready',token}));let pending='';channel.setEncoding('utf8');channel.on('data',text=>{pending+=text;if(pending.length>4096){channel.destroy();return;}for(let at=pending.indexOf('\n');at>=0;at=pending.indexOf('\n')){const line=pending.slice(0,at);pending=pending.slice(at+1);try{signal(JSON.parse(line));}catch{/* Ignore malformed internal control. */}}});channel.once('error',()=>{});channel.once('close',()=>{try{process.kill(-process.pid,'SIGTERM');}catch{}});}

// This process is the group leader. Only it signals its own group while alive;
// the service never sends a signal to a remembered numeric process group.
process.on('SIGTERM',()=>{});
function signal(message:unknown) {
  if(message==='SIGTERM' || message==='SIGKILL') {
    try {process.kill(-process.pid,message);} catch {/* Exit observation remains authoritative. */}
  }
}
process.on('message',signal);
const command=process.argv[2] ?? '';
const shell=spawn(process.env.SHELL || '/bin/sh',['-c',command],{env:process.env,stdio:channel?'inherit':['pipe','pipe','pipe']});
if(!channel){process.stdin.pipe(shell.stdin!);shell.stdin!.on('error',()=>{});shell.stdout!.pipe(process.stdout);shell.stderr!.pipe(process.stderr);}
shell.once('error',()=>send({type:'failed'}));
shell.once('exit',(code,signal)=>send({type:'exited',code,signal}));
// Pipes can close while a background process remains in the group. Keep the
// group leader alive until a host process listing observes no other members.
// If inspection fails, retain ownership rather than claim the group has exited.
function waitForGroup() {
  const listing=spawn('/bin/ps',['-axo','pid=,pgid=,stat='],{detached:true,stdio:['ignore','pipe','ignore']});
  let output='',failed=false;
  listing.stdout.setEncoding('utf8');listing.stdout.on('data',(chunk:string)=>{output+=chunk;});
  listing.once('error',()=>{failed=true;});
  listing.once('close',code=>{
    if(failed || code!==0) {setTimeout(waitForGroup,250);return;}
    const other=output.split('\n').some(line=>{
      const match=line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)/);
      return match && Number(match[2])===process.pid && Number(match[1])!==process.pid && !(match[3] ?? '').startsWith('Z');
    });
    if(other){setTimeout(waitForGroup,100);return;}
    send({type:'closed'},()=>{if(channel){channel.end();channel.destroy();process.exit(0);}else {process.stdin.destroy();if(process.connected)process.disconnect();}});
  });
}
shell.once('close',waitForGroup);
