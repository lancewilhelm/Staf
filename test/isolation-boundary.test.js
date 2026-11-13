import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectDockerInfo,inspectScratchContainer,scratchEntryScript, scratchPlatformAvailable} from '../dist/isolation-boundary.js';
import {startInstance} from './fixtures/controlled-instance.mjs';
import {executeShellSandbox,scratchLimits} from '../dist/shell-sandbox.js';
import {randomUUID} from 'node:crypto';

const id='sha256:'+ 'a'.repeat(64);
const command='echo safe';
const config=()=>({Image:id,Config:{User:'65534:65534',WorkingDir:'/workspace',Entrypoint:['/bin/sh'],Cmd:['-c',scratchEntryScript,'staf-scratch',command],Env:['PATH=/usr/bin:/bin','HOME=/nonexistent']},HostConfig:{Privileged:false,ReadonlyRootfs:true,NetworkMode:'none',PidMode:'',IpcMode:'private',UTSMode:'',UsernsMode:'',CgroupnsMode:'private',LogConfig:{Type:'none'},RestartPolicy:{Name:'no'},CapDrop:['ALL'],CapAdd:null,SecurityOpt:['no-new-privileges','seccomp=builtin'],Binds:null,Mounts:null,Devices:[],DeviceRequests:[],Tmpfs:{'/workspace':'rw,nosuid,nodev,noexec,size=16777216,nr_inodes=1024,uid=65534,gid=65534,mode=0700'}},Mounts:[]});
const limits={sizeBytes:16777216,maxInodes:1024};

test('scratch runtime selects only Linux and rejects altered container authority',()=>{
 assert.equal(scratchPlatformAvailable('darwin'),false);assert.equal(scratchPlatformAvailable('linux'),true);
 assert.doesNotThrow(()=>inspectScratchContainer(config(),id,limits,command));
 for(const change of [c=>c.HostConfig.Privileged=true,c=>c.HostConfig.NetworkMode='host',c=>c.HostConfig.PidMode='host',c=>c.HostConfig.IpcMode='host',c=>c.HostConfig.CgroupnsMode='host',c=>c.HostConfig.UTSMode='host',c=>c.HostConfig.UsernsMode='host',c=>c.HostConfig.LogConfig.Type='json-file',c=>c.HostConfig.RestartPolicy.Name='always',c=>c.HostConfig.ReadonlyRootfs=false,c=>c.HostConfig.CapDrop=[],c=>c.HostConfig.CapAdd=['SYS_ADMIN'],c=>c.HostConfig.SecurityOpt=['no-new-privileges'],c=>c.HostConfig.SecurityOpt.push('seccomp=unconfined'),c=>c.Config.Env.push('SECRET=value'),c=>c.Config.Cmd[1]='true',c=>c.Config.User='0:0',c=>c.Image='sha256:'+ 'b'.repeat(64),c=>c.HostConfig.Binds=['/:/host'],c=>c.HostConfig.Tmpfs['/workspace']='rw',c=>c.Mounts=[{Type:'bind',Destination:'/host'}]]) {const value=config();change(value);assert.throws(()=>inspectScratchContainer(value,id,limits,command));}
});

test('Docker must report a Linux engine with seccomp support',()=>{
 assert.doesNotThrow(()=>inspectDockerInfo({OSType:'linux',SecurityOptions:['name=seccomp,profile=default']}));
 for(const value of [{OSType:'windows',SecurityOptions:['name=seccomp']},{OSType:'linux',SecurityOptions:[]},{OSType:'linux'},null])assert.throws(()=>inspectDockerInfo(value));
});

test('the entry wrapper runs no command unless every kernel-state field is present and safe',()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-scratch-preflight-')),status=join(dir,'status'),marker=join(dir,'marker');
 const script=scratchEntryScript.replace('/proc/self/status',status),command=`printf safe > '${marker}'`;
 const run=()=>spawnSync('/bin/sh',['-c',script,'fixture',command],{encoding:'utf8'});
 const good='Seccomp:\t2\nNoNewPrivs:\t1\nCapEff:\t0000000000000000\nCapPrm:\t0000000000000000\nCapBnd:\t0000000000000000\n';
 try {for(const text of ['',good.replace('Seccomp:\t2','Seccomp:\t0'),good.replace('NoNewPrivs:\t1','NoNewPrivs:\t0'),good.replace('CapBnd:\t0000000000000000','CapBnd:\t0000000000000001')]){writeFileSync(status,text);assert.notEqual(run().status,0);assert.equal(existsSync(marker),false);}writeFileSync(status,good);assert.equal(run().status,0);assert.equal(existsSync(marker),true);}
 finally {rmSync(dir,{recursive:true,force:true});}
});

test('unsupported hosts reject scratch before approval and before an executor is called',{skip:process.platform==='linux'?'Linux takes the separate engine path':false},async()=>{
 let executions=0,seen='';const app=startInstance(':memory:',0,{shellExecutor:async()=>{executions++;throw Error('unexpected');},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){if(messages.at(-1)?.role==='tool'){seen=messages.at(-1).content;return {role:'assistant',content:'done'};}return {role:'assistant',content:null,tool_calls:[{id:'scratch',type:'function',function:{name:'run_scratch_shell',arguments:JSON.stringify({command:'echo safe'})}}]};}})});
 try{const port=await app.listen();let token;const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok);return r.json();};token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'Unsupported',provider:'live',model:'fixture-offline',toolMode:'direct'});const cfg=await call('/api/shell-config');await call('/api/shell-config',{revision:cfg.revision,dockerBinary:'/usr/bin/docker',dockerSocket:'/tmp/staf-nonexistent-docker.sock',imageId:id});await call('/api/shell-permissions/instance',{enabled:true});await call('/api/shell-permissions/bot:'+bot.id,{enabled:true});await call('/api/commands',{id:'unsupported-scratch',botId:bot.id,content:'Try scratch'});for(let i=0;i<500;i++){if((await call('/api/commands/unsupported-scratch')).state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(executions,0);assert.deepEqual(await call('/api/shell-approvals'),[]);assert.match(seen,/unavailable on this platform/);
 }finally{await app.close();}
});

const dockerBinary=process.env.STAF_TEST_DOCKER_BINARY,dockerSocket=process.env.STAF_TEST_DOCKER_SOCKET,imageId=process.env.STAF_TEST_DOCKER_IMAGE;
test('Linux scratch blocks disposable host data and privilege attempts while allowing ordinary work',{
 skip:process.platform!=='linux' || !dockerBinary || !dockerSocket || !imageId?'Requires a controlled Linux Docker engine and pinned fixture image':false,timeout:30000,
},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-linux-isolation-')),path=join(dir,'host-secret'),secret='synthetic-linux-secret-4831';writeFileSync(path,secret+'\n',{mode:0o600});
 const old=process.env.STAF_SYNTHETIC_ISOLATION_SECRET;process.env.STAF_SYNTHETIC_ISOLATION_SECRET=secret;
 try {
  const command=`direct=0; test -r '${path}' && direct=1; transformed=$(while IFS= read -r line; do printf '%s' "x$line"; done < '${path}' 2>/dev/null) || transformed=''; test "$direct" = 0 && test -z "$transformed" || exit 41; test ! -e /proc/${process.pid}/environ || exit 42; test -z "\${STAF_SYNTHETIC_ISOLATION_SECRET+x}" || exit 43; test ! -S /var/run/docker.sock || exit 44; if command -v unshare >/dev/null 2>&1; then unshare -Ur true >/dev/null 2>&1 && exit 45; fi; printf ordinary > /workspace/result; cat /workspace/result`;
  const result=await executeShellSandbox({executionId:randomUUID(),dockerBinary,dockerSocket,imageId,workspace:{kind:'scratch',sizeBytes:scratchLimits.sizeBytes,maxInodes:scratchLimits.maxInodes},command,timeoutMs:scratchLimits.timeoutMs,maxOutputBytes:scratchLimits.maxOutputBytes,signal:new AbortController().signal});
  assert.equal(result.exitCode,0);assert.equal(result.outputComplete,true);assert.match(result.output,/ordinary/);assert.ok(!result.output.includes(secret));
 } finally {if(old===undefined)delete process.env.STAF_SYNTHETIC_ISOLATION_SECRET;else process.env.STAF_SYNTHETIC_ISOLATION_SECRET=old;rmSync(dir,{recursive:true,force:true});}
});
