import { spawn } from 'node:child_process';

// This process is the group leader. Only it signals its own group while alive;
// the service never sends a signal to a remembered numeric process group.
process.on('SIGTERM',()=>{});
process.on('message',message=>{
  if(message==='SIGTERM' || message==='SIGKILL') {
    try {process.kill(-process.pid,message);} catch {/* Exit observation remains authoritative. */}
  }
});
const command=process.argv[2] ?? '';
const shell=spawn(process.env.SHELL || '/bin/sh',['-c',command],{env:process.env,stdio:['ignore','pipe','pipe']});
shell.stdout.pipe(process.stdout);shell.stderr.pipe(process.stderr);
shell.once('error',()=>process.send?.({type:'failed'}));
shell.once('exit',(code,signal)=>process.send?.({type:'exited',code,signal}));
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
    if(process.connected) process.send?.({type:'closed'},()=>process.disconnect());
  });
}
shell.once('close',waitForGroup);
