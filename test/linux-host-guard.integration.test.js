import {strict as assert} from 'node:assert';
import {spawn} from 'node:child_process';
import {chmodSync,closeSync,existsSync,linkSync,mkdtempSync,openSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {basename,join} from 'node:path';
import {once} from 'node:events';
import test from 'node:test';

const workspace=process.env.STAF_TEST_LINUX_WORKSPACE;
const enabled=process.platform==='linux' && !!workspace;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Opt in only on a disposable Linux machine where an operator has deliberately
// installed the fixed candidate launcher and configured its workspace. This
// does not install software, modify sudoers or contact a real provider.
test('candidate Linux launcher confines a disposable process and its descendants',{
  skip:enabled?false:'Requires an operator-prepared disposable Linux workspace and launcher',timeout:20000,
},async()=>{
  const outside=mkdtempSync(join(tmpdir(),'staf-host-private-'));
  const inside=mkdtempSync(join(workspace,'staf-boundary-'));
  const secret='synthetic-boundary-secret-482913',secretFile=join(outside,'private');
  const socketPath=join(inside,'host.sock'),late=join(inside,'late');
  chmodSync(inside,0o777);writeFileSync(secretFile,secret,{mode:0o600});
  symlinkSync(secretFile,join(inside,'outside-link'));
  writeFileSync(join(inside,'private'),secret,{mode:0o600});linkSync(join(inside,'private'),join(inside,'private-link'));
  const server=createServer(socket=>socket.end('host-service'));
  await new Promise((resolve,reject)=>server.once('error',reject).listen(socketPath,resolve));chmodSync(socketPath,0o777);
  const fd=openSync(secretFile,'r');
  const children=new Set();
  const launch=()=>{
    const child=spawn('/usr/bin/sudo',['-n','-u','staf-exec','-g','staf-exec','--','/usr/lib/staf-exec/launch'],{
      env:{PATH:'/usr/bin:/bin',STAF_SYNTHETIC_BOUNDARY_SECRET:secret},stdio:['pipe','pipe','pipe',fd],
    });
    children.add(child);child.once('close',()=>children.delete(child));return child;
  };
  const ready=async(child,command,cwd=basename(inside))=>{
    let pending='',errors='';child.stderr.on('data',data=>{errors+=data.toString();});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('guard did not become ready: '+errors)),5000);
      child.once('error',reject);child.once('exit',()=>reject(Error('guard exited before ready: '+errors)));
      child.stdout.on('data',function onData(data){pending+=data.toString();if(pending.includes('STAF-EXEC-READY-1\n')){clearTimeout(timer);child.stdout.off('data',onData);resolve();}});
    });
    child.stdin.write(Buffer.from(cwd).toString('base64')+'\n'+Buffer.from(command).toString('base64')+'\n');
  };
  try {
    const script=`import base64, ctypes, errno, os, socket\nsecret=${JSON.stringify(secret)}\nassert not os.environ.get('STAF_SYNTHETIC_BOUNDARY_SECRET')\nassert os.getresuid()==(65534,65534,65534) and os.getresgid()==(65534,65534,65534)\nstatus=dict(line.split(':',1) for line in open('/proc/self/status') if ':' in line)\nassert status['NoNewPrivs'].strip()=='1' and status['Seccomp'].strip()=='2'\nfor cap in ('CapEff','CapPrm','CapInh','CapBnd'):\n assert int(status[cap].strip(),16)==0\nfor path in (${JSON.stringify(secretFile)}, 'outside-link', 'private-link'):\n try:\n  data=open(path,'rb').read()\n  raise AssertionError('private file read succeeded, including transformed read: '+str(len(base64.b64encode(data))))\n except (FileNotFoundError, PermissionError): pass\ntry:\n data=open('/proc/${process.pid}/environ','rb').read()\n assert secret.encode() not in data\nexcept (FileNotFoundError, PermissionError, ProcessLookupError): pass\nfor switch in (os.setuid,os.setgid):\n try:\n  switch(0)\n  raise AssertionError('privilege switch succeeded')\n except OSError: pass\ntry:\n os.fstat(3)\n raise AssertionError('inherited file descriptor')\nexcept OSError as e:\n assert e.errno == errno.EBADF\ns=socket.socket(socket.AF_UNIX)\ntry:\n s.connect('host.sock')\n raise AssertionError('connected to host socket')\nexcept OSError: pass\nfor family in (socket.AF_INET, getattr(socket,'AF_VSOCK',40)):\n try:\n  socket.socket(family)\n  raise AssertionError('network socket allowed')\n except OSError: pass\nlibc=ctypes.CDLL(None, use_errno=True)\nassert libc.unshare(0x10000000)==-1\ntry:\n os.mkfifo('blocked-fifo')\n raise AssertionError('FIFO creation allowed')\nexcept OSError: pass\nopen('ordinary','w').write('ok')\nassert open('ordinary').read()=='ok'\nprint('boundary-ok')`;
    const child=launch(),output=[];child.stdout.on('data',data=>output.push(data));
    await ready(child,`exec /usr/bin/python3 -c 'import base64;exec(base64.b64decode("${Buffer.from(script).toString('base64')}"))'`);
    child.stdin.end();const [code]=await once(child,'close');
    assert.equal(code,0,Buffer.concat(output).toString());assert.match(Buffer.concat(output).toString(),/boundary-ok/);
    const escape=launch();const escapeClosed=once(escape,'close');
    await ready(escape,'printf escaped > /workspace/'+basename(inside)+'/late','../');
    escape.stdin.end();const [escapeCode]=await escapeClosed;
    assert.notEqual(escapeCode,0);assert.equal(existsSync(late),false,'an invalid cwd dispatched the command');
    const background=launch();
    const backgroundStarted=new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('background child did not start')),5000);
      background.stdout.on('data',data=>{output+=data.toString();if(output.includes('BACKGROUND_READY')){clearTimeout(timer);resolve();}});
      background.once('exit',()=>{clearTimeout(timer);reject(Error('launcher exited before background child started'));});
    });
    await ready(background,"(sleep 1; printf escaped > late) & printf BACKGROUND_READY; wait");
    await backgroundStarted;background.kill('SIGKILL');await once(background,'close');await delay(1500);
    assert.equal(existsSync(late),false,'a descendant survived the launcher');
  } finally {
    for(const child of children)child.kill('SIGKILL');closeSync(fd);
    await new Promise(resolve=>server.close(resolve));rmSync(inside,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});
  }
});

test('candidate Linux launcher retains a usable PTY after its readiness handshake',{
  skip:enabled?false:'Requires an operator-prepared disposable Linux workspace and launcher',timeout:15000,
},async()=>{
  const dir=mkdtempSync(join(workspace,'staf-pty-boundary-'));chmodSync(dir,0o777);
  const {spawn:spawnPty}=await import('node-pty');
  const terminal=spawnPty('/usr/bin/sudo',['-n','-u','staf-exec','-g','staf-exec','--','/usr/lib/staf-exec/launch'],{
    name:'xterm-256color',cols:80,rows:24,env:{PATH:'/usr/bin:/bin'},
  });
  let output='',sentCommand=false,sentInput=false;
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('PTY did not complete: '+output)),10000);
      terminal.onData(data=>{
        output+=data;
        if(!sentCommand && output.includes('STAF-EXEC-READY-1')){
          sentCommand=true;
          const command='test -t 0 && printf PTY_READY; IFS= read -r line; printf "RESULT:%s" "$line"';
          terminal.write(Buffer.from(basename(dir)).toString('base64')+'\n'+Buffer.from(command).toString('base64')+'\n');
        }
        if(!sentInput && output.includes('PTY_READY')){sentInput=true;terminal.write('hello\n');}
        if(output.includes('RESULT:hello')){clearTimeout(timer);resolve();}
      });
      terminal.onExit(()=>{clearTimeout(timer);if(!output.includes('RESULT:hello'))reject(Error('PTY exited early: '+output));});
    });
    assert.match(output,/RESULT:hello/);
  } finally {terminal.kill();rmSync(dir,{recursive:true,force:true});}
});
