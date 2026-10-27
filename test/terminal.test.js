import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { TerminalView, cleanText } from '../dist/terminal-view.js';

test('semantic presentation respects NO_COLOR/dumb/non-TTY and removes untrusted terminal controls', () => {
 assert.equal(new TerminalView(false,{FORCE_COLOR:'1'}).style('status','status'),'status');
 assert.equal(new TerminalView(true,{NO_COLOR:'',TERM:'xterm'}).style('status','status'),'status');
 assert.equal(new TerminalView(true,{TERM:'dumb'}).style('status','status'),'status');
 assert.match(new TerminalView(true,{TERM:'xterm'}).style('Heading','heading'),/\x1b\[36m/);
 assert.equal(cleanText('hello\x1b[31m red\x1b[0m\x1b]0;bad\x07'),'hello red');
});

test('plain pipeline keeps slash commands, readable blocks, history/resume and no escape sequences', async t => {
 const root=await mkdtemp(join(tmpdir(),'staf-plain-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const run=(args,input)=>spawnSync(process.execPath,['dist/cli.js','--provider','demo','--data-dir',root,...args],{input,encoding:'utf8',env:{...process.env,NO_COLOR:'',FORCE_COLOR:'1'}});
 const first=run([], '/settings\n/settings cancel\n/auth codex status\n/auth codex nonsense\nwhat time is it?\nhello\x1b[31m red\n/quit\n');
 assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/Settings \(no model call\)/);assert.match(first.stdout,/not signed in/);assert.match(first.stderr,/Use \/auth codex/);assert.match(first.stdout,/tool_result/);assert.match(first.stdout,/staf>/);assert.ok(!first.stdout.includes('\x1b'));
 const id=first.stdout.match(/session ([0-9a-f-]{36})/)[1];
 const next=run(['--session',id],'hello again\n/quit\n');assert.equal(next.status,0,next.stderr);assert.match(next.stdout,/User turns saved: 3/);
});

test('real POSIX PTY: arrows/hjkl, nested scopes/catalogs/editor/confirm, cancellation, raw cleanup and narrow/plain modes', {skip: process.platform==='win32', timeout:45000}, () => {
 const script = String.raw`
import sys,os,pty,fcntl,termios,struct,subprocess,select,time,tempfile,shutil,json,signal,re,uuid,urllib.parse,urllib.request
root=tempfile.mkdtemp(prefix='staf-pty-suite-',dir='/tmp')
node=os.environ['STAF_TEST_NODE']
bin=os.path.join(root,'bin');os.mkdir(bin)
preload=os.path.join(root,'fetch.mjs')
open(preload,'w').write("""import {generateKeyPairSync,sign} from 'node:crypto';
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
globalThis.fetch=async(url,init)=>{
 if(String(url)==='https://api.openai.com/v1/models')return Response.json({models:[{slug:'fake-model',display_name:'Fake',context_window:32000,supported_reasoning_levels:[{effort:'low'},{effort:'high'}]}]});
 if(String(url)==='https://auth.openai.com/.well-known/jwks.json')return Response.json({keys:[{...keys.publicKey.export({format:'jwk'}),kid:'offline'}]});
 if(String(url)==='https://auth.openai.com/api/accounts/oauth/token'){
  const params=new URLSearchParams(init.body),header=Buffer.from(JSON.stringify({alg:'RS256',kid:'offline'})).toString('base64url');
  const body=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',sub:'dummy',aud:'oaiapp_offline',nonce:params.get('code'),exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const token=header+'.'+body+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+body),keys.privateKey).toString('base64url');
  return Response.json({token_type:'Bearer',access_token:'dummy-access',refresh_token:'dummy-refresh',id_token:token,expires_in:3600,scope:'openid resource.invoke chatgpt.tokens.use.direct offline_access'});
 }
 throw Error('offline fixture blocked request');
};""")
fake=os.path.join(bin,'codex')
with open(fake,'w') as f:
 f.write('#!'+node+'\n'+"if(process.argv[2]==='debug')console.log(JSON.stringify({models:[{slug:'fake-model',display_name:'Fake',context_window:32000,supported_reasoning_levels:[{effort:'low'},{effort:'high'}]}]}));else process.exit(7);\n")
os.chmod(fake,0o700)
ansi=re.compile(rb'\x1b\[[0-?]*[ -/]*[@-~]')
class Terminal:
 def __init__(self,name,no_color=False,dumb=False,narrow=False,bad=False,measured=False,unsigned=False,codex=False):
  self.data=os.path.join(root,name);self.master,self.slave=pty.openpty();self.before=termios.tcgetattr(self.slave);self.buf=b'';self.all=b''
  session_args=[]
  if measured:
   os.makedirs(self.data);sid=str(uuid.uuid4());session_args=['--session',sid]
   payload={'version':1,'id':sid,'provider':'openrouter:old-model','messages':[{'role':'user','content':'synthetic'},{'role':'assistant','content':'reply'}],'events':[],'usage':[{'id':'one','attempt':'one','turnStart':0,'provider':'openrouter:old-model','model':'old-model','observedAt':'2026-10-26T00:00:00Z','scope':'request','status':'reported','source':'OpenRouter response.usage (cost in account credits)','latencyMs':1,'outcome':'response','metrics':{'input':1000,'cachedInput':500}}]}
   open(os.path.join(self.data,sid+'.json'),'w').write(json.dumps(payload))
  os.makedirs(os.path.join(self.data,'auth'),exist_ok=True)
  auth=os.path.join(self.data,'auth','codex-direct.json')
  if not unsigned and not os.path.exists(auth):
   open(auth,'w').write(json.dumps({'version':1,'issuer':'https://auth.openai.com','subject':'dummy','clientId':'oaiapp_dummy','hostId':'urn:uuid:dummy','accessToken':'dummy-access','refreshToken':'dummy-refresh','idToken':'dummy-id','scopes':['chatgpt.tokens.use.direct','resource.invoke'],'expiresAt':int(time.time()*1000)+3600000}));os.chmod(auth,0o600)
  if bad:
   os.makedirs(os.path.join(self.data,'config'));open(os.path.join(self.data,'config','settings.json'),'w').write('broken')
  fcntl.ioctl(self.slave,termios.TIOCSWINSZ,struct.pack('HHHH',12 if narrow else 28,32 if narrow else 100,0,0))
  env=os.environ.copy();env['TERM']='dumb' if dumb else 'xterm-256color';env['PATH']=bin+':'+env.get('PATH','')
  env['NODE_OPTIONS']='--import='+preload;env['STAF_CODEX_MODEL']='';env.pop('FORCE_COLOR',None)
  if no_color:env['NO_COLOR']=''
  else:env.pop('NO_COLOR',None)
  def setup():os.setsid();fcntl.ioctl(self.slave,termios.TIOCSCTTY,0)
  wrapper="import sys,subprocess,termios,signal; before=termios.tcgetattr(0)[3]; p=subprocess.Popen(sys.argv[1:]); signal.signal(signal.SIGINT,signal.SIG_IGN); code=p.wait(); after=termios.tcgetattr(0)[3]; mask=termios.ICANON|termios.ECHO; good=(before&mask)==(after&mask); print('STAF_RAW_RESTORED' if good else 'STAF_RAW_LEAK',flush=True); sys.exit(code if good else 99)"
  self.p=subprocess.Popen([sys.executable,'-c',wrapper,node,'dist/cli.js','--data-dir',self.data]+(['--provider','codex'] if codex else [])+session_args,stdin=self.slave,stdout=self.slave,stderr=self.slave,env=env,preexec_fn=setup)
  self.wait('Codex setup' if codex and unsigned else 'you>')
 def wait(self,text):
  end=time.monotonic()+5
  while time.monotonic()<end:
   if text.encode() in self.buf:return
   ready,_,_=select.select([self.master],[],[],.05)
   if ready:
    try:chunk=os.read(self.master,65536)
    except OSError:break
    self.buf+=chunk;self.all+=chunk
  raise AssertionError('missing '+text+': '+repr(self.buf[-1500:]))
 def send(self,keys,expect):
  self.buf=b'';os.write(self.master,keys);self.wait(expect)
 def stop(self,keys=b'/quit\r'):
  os.write(self.master,keys)
  deadline=time.monotonic()+4
  while self.p.poll() is None and time.monotonic()<deadline:
   ready,_,_=select.select([self.master],[],[],.05)
   if ready:
    try:self.all+=os.read(self.master,65536)
    except OSError:break
  assert self.p.poll() is not None,'process failed to exit while PTY output was drained'
  assert self.p.returncode==0,self.all[-1000:]
  assert b'STAF_RAW_RESTORED' in self.all,'raw flags leaked'
  assert not any(name.endswith('.lock') for name in os.listdir(self.data)),'session lock leaked'
  os.close(self.master);os.close(self.slave)
 def open(self):self.send(b'/settings\r','Staf settings')
 def apply(self):self.send(b'k\r','Setting applied');self.send(b'\r','Staf settings')
try:
 # No credentials: confirmed provider selection offers setup, no network until sign-in.
 u=Terminal('unsigned',unsigned=True)
 u.open();u.send(b'j\r','Choose scope: provider');u.send(b'\r','Provider: session');u.send(b'jj\r','Confirm setting');u.send(b'k\r','Codex setup')
 assert not os.path.exists(os.path.join(u.data,'auth','codex-host.json'))
 def callback(terminal,denied=False):
  clean=ansi.sub(b'',terminal.buf).replace(b'\r',b'')
  url=re.search(rb'https://auth.openai.com/api/accounts/authorize\?[^\s]+',clean).group().decode()
  query=urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
  params={'state':query['state'][0]}
  if denied:params['error']='access_denied'
  else:params.update({'client_id':'oaiapp_offline','code':query['nonce'][0]})
  target=query['redirect_uri'][0]+'?'+urllib.parse.urlencode(params)
  try:urllib.request.urlopen(target,timeout=4).read()
  except urllib.error.HTTPError as error:assert denied and error.code==400
 u.send(b'\r','open this URL');callback(u,True);u.wait('you>')
 assert not os.path.exists(os.path.join(u.data,'auth','codex-direct.json'))
 u.send(b'/auth codex login\r','open this URL');callback(u);u.wait('you>')
 u.send(b'/auth codex status\r','you>');assert b'registration present' in u.buf
 u.send(b'/auth codex logout\r','you>');assert not os.path.exists(os.path.join(u.data,'auth','codex-direct.json'))
 # Menu-driven retry resumes model selection after the same signed dummy callback.
 u.open();u.send(b'kk\r','Codex setup');u.send(b'\r','open this URL');callback(u);u.wait('Model: codex')
 u.send(b'\r','Models: codex');u.send(b'\r','Confirm setting');u.apply();u.send(b'\x1b','you>')
 u.send(b'/settings show\r','you>');assert b'fake-model' in u.buf
 u.stop()
 # Startup with Codex selected offers setup; skipping and Ctrl-C clean up input/locks.
 startup=Terminal('startup-unsigned',unsigned=True,codex=True);startup.send(b'\x1b','Staf settings');startup.send(b'\x1b','you>');startup.stop()
 cancel=Terminal('cancel-login',unsigned=True,codex=True);cancel.send(b'\r','open this URL');cancel.stop(b'\x03')
 assert not os.path.exists(os.path.join(cancel.data,'auth','codex-direct.json'))
 t=Terminal('navigation')
 assert b'\x1b[36m' in t.all,'semantic color missing'
 for _ in range(2):t.open();t.send(b'\x1b','you>')
 assert not os.path.exists(os.path.join(t.data,'config','settings.json'))
 t.send(b'/usage\r','you>');assert b'Usage' in t.buf and b'quota' in t.buf
 t.send(b'/usage help\r','you>');assert b'Prompt caching' in t.buf
 t.send(b'/context\r','you>');assert b'Compaction: not implemented' in t.buf
 t.open();t.send(b'j\x1b[C','Choose scope: provider');t.send(b'\x1b[D','Staf settings')
 t.send(b'\x1b[A\x1b[B\r','Choose scope: provider');t.send(b'l','Provider: session');t.send(b'jj\r','Confirm setting')
 t.send(b'\r','Provider: session') # Cancel is focused by default.
 t.send(b'\r','Confirm setting');t.apply() # selection remains codex
 t.send(b'jj\r','Choose scope: model');t.send(b'\r','Target provider: model');t.send(b'\r','Model: codex');t.send(b'\r','Models: codex');t.send(b'\r','Confirm setting');t.apply()
 # Catalog Back skips its transient loading screen; repeated visits have the same parent.
 t.send(b'jj\r','Choose scope: model');t.send(b'\r','Target provider: model');t.send(b'\r','Model: codex')
 for _ in range(2):
  t.send(b'\r','Models: codex');t.send(b'h','Model: codex');assert b'Model catalog' not in t.buf
 t.send(b'j\r','Model ID');t.send(b'\x15discarded','discarded');t.send(b'\r','Confirm setting');t.send(b'h','Model ID');t.send(b'\x1b','Model: codex');t.send(b'h','Target provider: model');t.send(b'h','Choose scope: model');t.send(b'h','Staf settings')
 t.send(b'j\r','Choose scope: reasoning');t.send(b'\r','Target provider: reasoning');t.send(b'\r','Reasoning: codex');t.send(b'j\r','Efforts: codex');t.send(b'j\r','Confirm setting');t.apply()
 assert not os.path.exists(os.path.join(t.data,'config','settings.json')),'session edits saved defaults'
 t.send(b'\x1b','you>');t.send(b'/context refresh\r','you>');assert b'32000 advertised' in t.buf and b'next payload' in t.buf
 t.send(b'/settings show\r','you>');assert b'fake-model' in t.buf and b'high' in t.buf
 t.send(b'/settings set session provider demo\r','you>')
 t.open();t.send(b'jj\r','Choose scope: model');t.send(b'j\r','Target provider: model');t.send(b'j\r','Model: codex');t.send(b'j\r','Model ID')
 t.send(b'\x15hjklmanual','hjklmanual');t.send(b'\r','Confirm setting');t.send(b'\x1b','Model ID');assert b'hjklmanual' in t.buf,'draft lost on cancel'
 t.send(b'\x15hjkl\x1b[D\x7f\x1b[Cx','hjlx');t.send(b'\r','Confirm setting');t.apply()
 saved=json.load(open(os.path.join(t.data,'config','settings.json')));assert saved['defaults']['model.codex']=='hjlx',saved
 t.send(b'\x1b','you>');t.send(b'/settings set session provider demo\r','you>');t.send(b'what time is it?\r','you>');assert b'tool_result' in t.buf and b'Measured:' not in t.buf and b'bytes/4' not in t.buf
 t.open();t.send(b'j\r','Choose scope: provider');t.send(b'\r','Provider: session');t.send(b'\r','Confirm setting');t.apply();
 t.send(b'\x1b','you>');t.stop()
 # Ordinary startup, a personal default, and restart preserve source and product defaults.
 fresh=Terminal('personal');fresh.open();fresh.send(b'j\r','Choose scope: provider');fresh.send(b'j\r','Provider: default');fresh.send(b'j\r','Confirm setting');fresh.apply();fresh.send(b'\x1b','you>');fresh.stop()
 again=Terminal('personal');assert b'openrouter' in again.all;again.send(b'/settings show\r','you>');assert b'saved' in again.buf
 again.send(b'/settings set session provider demo\r','you>');again.send(b'hello\r','you>');again.stop()
 draft=Terminal('draft');draft.send(b'/settings\rdraft-hjkl','Staf settings');draft.send(b'\x1b','you>');draft.send(b'\r','staf>');draft.stop()
 messages=[]
 for name in os.listdir(draft.data):
  if name.endswith('.json'):messages=json.load(open(os.path.join(draft.data,name)))['messages']
 assert any(m.get('role')=='user' and m.get('content')=='draft-hjkl' for m in messages),'unfinished chat input lost'
 bad=Terminal('bad',bad=True);bad.open();bad.send(b'jjjjjj\r','Configuration path');bad.send(b'h','Staf settings');time.sleep(.1);bad.send(b'\x1b','you>');bad.stop()
 assert open(os.path.join(bad.data,'config','settings.json')).read()=='broken'
 # NO_COLOR preserves menu navigation but never uses semantic SGR color.
 n=Terminal('narrow',no_color=True,narrow=True);n.open();menu=ansi.sub(b'',n.buf).replace(b'\r',b'')
 assert all(len(line)<=31 for line in menu.splitlines() if line),'menu overflow'
 assert not re.search(rb'\x1b\[(?:0|2|3[0-7])m',n.all)
 n.send(b'\x1b','you>');n.stop()
 for key,name in [(b'\x03','ctrl-c'),(b'\x04','ctrl-d')]:
  c=Terminal(name);c.open();c.stop(key);assert not os.path.exists(os.path.join(c.data,'config','settings.json'))
 e=Terminal('chat-eof');e.stop(b'\x04')
 m=Terminal('measured',measured=True);m.send(b'/context\r','you>');assert b'last HTTP request input 1000 tokens (500 cached, already included)' in m.buf and b'historical: openrouter:old-model' in m.buf
 m.send(b'/settings set session provider codex\r','you>');assert b'Context: ~' in m.buf and b'Measured:' not in m.buf and b'bytes/4' not in m.buf
 m.send(b'/context\r','you>');assert b'Measured:' in m.buf and b'next payload' in m.buf;m.stop()
 d=Terminal('dumb',dumb=True);d.send(b'/settings\r','Settings (no model call)');assert b'\x1b' not in d.all;d.stop()
 print('PTY PASS: navigation/scopes/models/reasoning/editor/cancel/reopen/NO_COLOR/narrow/dumb/EOF/Ctrl-C/raw/locks')
finally:
 for value in list(locals().values()):
  if isinstance(value,Terminal) and value.p.poll() is None:
   os.close(value.master);os.close(value.slave);value.p.kill();value.p.wait(timeout=2)
 shutil.rmtree(root)
`;
 const result=spawnSync('python3',['-c',script],{encoding:'utf8',timeout:40000,env:{...process.env,STAF_TEST_NODE:process.execPath}});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/PTY PASS/);
});
