import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { TerminalView, cleanText } from '../dist/terminal-view.js';

test('semantic presentation respects NO_COLOR/dumb/non-TTY and removes untrusted terminal controls', () => {
 assert.equal(new TerminalView(false,{FORCE_COLOR:'1'}).style('status','status'),'status');
 assert.equal(new TerminalView(true,{NO_COLOR:'',TERM:'xterm'}).style('status','status'),'status');
 assert.equal(new TerminalView(true,{TERM:'dumb'}).style('status','status'),'status');
 assert.match(new TerminalView(true,{TERM:'xterm'}).style('Heading','heading'),/\x1b\[36m/);
 assert.equal(cleanText('hello\x1b[31m red\x1b[0m\x1b]0;bad\x07'),'hello red');
});

test('real POSIX PTY supports menu navigation, confirmation, editing, cancellation and terminal cleanup', {skip:process.platform==='win32',timeout:45000}, () => {
 const script=String.raw`
import sys,os,pty,fcntl,termios,struct,subprocess,select,time,tempfile,shutil,json,re,signal
root=tempfile.mkdtemp(prefix='staf-pty-',dir='/tmp')
node=os.environ['STAF_TEST_NODE']
class Terminal:
 def __init__(self,name,no_color=False,narrow=False,dumb=False):
  self.data=os.path.join(root,name);subprocess.run([node,'test/fixtures/demo-terminal.mjs',self.data],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);self.master,self.slave=pty.openpty();self.buf=b'';self.all=b''
  fcntl.ioctl(self.slave,termios.TIOCSWINSZ,struct.pack('HHHH',12 if narrow else 28,32 if narrow else 100,0,0))
  env=os.environ.copy();env['TERM']='dumb' if dumb else 'xterm-256color';env.pop('FORCE_COLOR',None)
  if no_color:env['NO_COLOR']=''
  else:env.pop('NO_COLOR',None)
  def setup():os.setsid();fcntl.ioctl(self.slave,termios.TIOCSCTTY,0)
  wrapper="import sys,subprocess,termios,signal; before=termios.tcgetattr(0)[3]; p=subprocess.Popen(sys.argv[1:]); signal.signal(signal.SIGINT,signal.SIG_IGN); code=p.wait(); after=termios.tcgetattr(0)[3]; mask=termios.ICANON|termios.ECHO; good=(before&mask)==(after&mask); print('RAW_RESTORED' if good else 'RAW_LEAK',flush=True); sys.exit(code if good else 99)"
  self.p=subprocess.Popen([sys.executable,'-c',wrapper,node,'dist/cli.js','--data-dir',self.data],stdin=self.slave,stdout=self.slave,stderr=self.slave,env=env,preexec_fn=setup)
  self.wait('you>')
 def wait(self,text):
  end=time.monotonic()+12
  while time.monotonic()<end:
   if text.encode() in self.buf:return
   ready,_,_=select.select([self.master],[],[],.05)
   if ready:
    try:chunk=os.read(self.master,65536)
    except OSError:break
    self.buf+=chunk;self.all+=chunk
  raise AssertionError('missing '+text+': '+repr(self.buf[-1800:]))
 def send(self,keys,expect):self.buf=b'';os.write(self.master,keys);self.wait(expect)
 def stop(self,keys=b'/quit\r'):
  os.write(self.master,keys);end=time.monotonic()+8
  while self.p.poll() is None and time.monotonic()<end:
   ready,_,_=select.select([self.master],[],[],.05)
   if ready:
    try:self.all+=os.read(self.master,65536)
    except OSError:break
  assert self.p.poll() is not None and self.p.returncode==0,repr(self.all[-1200:])
  assert b'RAW_RESTORED' in self.all,repr(self.all[-1200:])
  try:
   pid=json.load(open(os.path.join(self.data,'terminal-service.json')))['pid'];os.kill(pid,signal.SIGTERM)
  except (FileNotFoundError,ProcessLookupError):pass
  os.close(self.master);os.close(self.slave)
try:
 t=Terminal('normal');t.send(b'/settings\r','Staf settings');t.send(b'j\r','Provider');t.send(b'j\r','Confirm setting');assert b'Next request may send this chat' in t.buf and b'history to this provider.' in t.buf;t.send(b'\x1b','Provider');t.send(b'\x1b','Staf settings')
 t.send(b'j\r','Model');t.send(b'\r','Enter model');t.send(b'abc\x1b[D\x7fx','ax_c');t.send(b'\r','Confirm setting');t.send(b'k\r','Setting applied');t.send(b'\x1b','Confirm setting');t.send(b'\x1b','Enter model');t.send(b'\x1b','Model');t.send(b'\x1b','Staf settings');t.send(b'\x1b','you>');t.send(b'/settings show\r','Model: axc');t.stop()
 n=Terminal('narrow',True,True);n.send(b'/settings\r','Staf settings');assert not re.search(rb'\x1b\[(?:0|2|3[0-7])m',n.all);n.send(b'\x1b','you>');n.stop()
 d=Terminal('dumb',True,dumb=True);d.send(b'/settings\r','Provider: demo');assert b'\x1b' not in d.all;d.stop()
 c=Terminal('ctrl');c.send(b'/settings\r','Staf settings');c.stop(b'\x03')
 print('PTY PASS')
finally:
 for value in list(locals().values()):
  if isinstance(value,Terminal) and value.p.poll() is None:
   value.p.kill();value.p.wait(timeout=2)
   try:os.kill(json.load(open(os.path.join(value.data,'terminal-service.json')))['pid'],signal.SIGTERM)
   except (FileNotFoundError,ProcessLookupError):pass
 shutil.rmtree(root)
`;
 const result=spawnSync('python3',['-c',script],{encoding:'utf8',timeout:45000,env:{...process.env,STAF_TEST_NODE:process.execPath}});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/PTY PASS/);
});
