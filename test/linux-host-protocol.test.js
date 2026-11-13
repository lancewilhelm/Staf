import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {bundledFileWorkerHash,bundledLauncherHash,GuardHandshake,isolatedWorkingDirectory,selectLinuxHostBoundary} from '../dist/linux-host-boundary.js';

test('pinned launcher and worker hashes match the distributed files',()=>{
 const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
 assert.equal(hash('deploy/native-linux/staf-exec-launch.example'),bundledLauncherHash);
 assert.equal(hash('deploy/native-linux/staf-file-worker.mjs'),bundledFileWorkerHash);
});

test('launcher handshake never submits a command before the exact ready message',()=>{
 const writes=[],outputs=[];let started=0,failed=0;
 const protocol=new GuardHandshake({cwd:'project',command:'printf synthetic',send:bytes=>writes.push(bytes.toString()),started:()=>started++,output:bytes=>outputs.push(bytes.toString()),failed:()=>failed++});
 protocol.receive(Buffer.from('STAF-EXEC-REA'));assert.deepEqual(writes,[]);assert.equal(started,0);
 protocol.receive(Buffer.from('DY-1\r\nresult'));assert.equal(started,1);assert.equal(failed,0);
 assert.deepEqual(writes,[Buffer.from('project').toString('base64')+'\n'+Buffer.from('printf synthetic').toString('base64')+'\n']);
 assert.deepEqual(outputs,['result']);protocol.receive(Buffer.from('more'));assert.deepEqual(outputs,['result','more']);
});

test('approved workspace mapping rejects sibling and traversal paths',()=>{
 assert.equal(isolatedWorkingDirectory('/srv/staf-workspace','/srv/staf-workspace'),'.');
 assert.equal(isolatedWorkingDirectory('/srv/staf-workspace','/srv/staf-workspace/project'),'project');
 assert.equal(isolatedWorkingDirectory('/srv/staf-workspace','/workspace/project'),'project');
 for(const path of ['/workspace-other','/workspace/../private','/srv/staf-workspace-other','/srv/staf-workspace/../private','/tmp'])assert.throws(()=>isolatedWorkingDirectory('/srv/staf-workspace',path));
});

if(process.platform!=='linux')test('explicit Linux host configuration stays unavailable on this host',()=>{
 assert.equal(selectLinuxHostBoundary({enabled:true,dataDir:'/tmp',secretDir:'/tmp'}),null);
});

test('unexpected or incomplete launcher output fails closed without dispatch',()=>{
 for(const input of ['unexpected\n','STAF-EXEC-READY-2\n','STAF-EXEC-READY-1x', 'x'.repeat(8193)]) {
  const writes=[];let failed=0;const protocol=new GuardHandshake({cwd:'.',command:'printf never',send:bytes=>writes.push(bytes),started:()=>{},output:()=>assert.fail('output before ready'),failed:()=>failed++});
  protocol.receive(Buffer.from(input));assert.equal(failed,1,input);assert.deepEqual(writes,[]);
 }
});

test('a stopped launcher cannot dispatch after a late readiness message',()=>{
 let sent=0,started=0,failed=0;
 const protocol=new GuardHandshake({cwd:'.',command:'printf never',send:()=>sent++,started:()=>started++,output:()=>{},failed:()=>failed++});
 protocol.fail();protocol.receive(Buffer.from('STAF-EXEC-READY-1\n'));
 assert.equal(sent,0);assert.equal(started,0);assert.equal(failed,1);
});
