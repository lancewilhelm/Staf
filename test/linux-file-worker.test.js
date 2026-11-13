import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {closeSync,mkdtempSync,openSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {executeFileOperation,executeOpenedFileOperation} from '../deploy/native-linux/staf-file-worker.mjs';
import {fileCapabilities,validateFilePage} from '../dist/file-actions.js';
import {isolatedFileCapabilities} from '../dist/linux-file-actions.js';
import {redactor} from '../dist/config.js';

test('isolated file worker reads, edits, searches and verifies disposable workspace files',()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-file-worker-'));
 try {
  const written=executeFileOperation(root,{kind:'write',path:'sample',content:'before synthetic after'});
  assert.equal(written.sha256,createHash('sha256').update('before synthetic after').digest('hex'));
  const page=executeFileOperation(root,{kind:'read',path:'sample',offset:7,limit:9,overlap:16});
  assert.equal(Buffer.from(page.data,'base64').subarray(page.index,page.index+9).toString(),'synthetic');
  assert.equal(executeFileOperation(root,{kind:'verify',path:'sample',sha256:written.sha256}).matches,true);
  assert.throws(()=>executeFileOperation(root,{kind:'edit',path:'sample',expectedHash:'0'.repeat(64),oldText:'before',newText:'after'}));
  const edit=executeFileOperation(root,{kind:'edit',path:'sample',expectedHash:written.sha256,oldText:'before',newText:'changed'});
  assert.equal(readFileSync(join(root,'sample'),'utf8'),'changed synthetic after');
  assert.equal(executeFileOperation(root,{kind:'verify',path:'sample',sha256:edit.sha256}).matches,true);
  assert.deepEqual(executeFileOperation(root,{kind:'search',path:'sample',query:'synthetic',offset:0,limit:10}).matches,[8]);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('opened-file worker uses its descriptor after a pathname swap',()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-file-descriptor-'));let fd;
 try {
  const path=join(root,'sample');writeFileSync(path,'approved');writeFileSync(join(root,'other'),'different');fd=openSync(path,'r');
  renameSync(path,join(root,'moved'));symlinkSync(join(root,'other'),path);
  const page=executeOpenedFileOperation(fd,{kind:'read',offset:0,limit:32,overlap:16});
  assert.equal(Buffer.from(page.data,'base64').toString(),'approved');
 } finally {if(fd!==undefined)closeSync(fd);rmSync(root,{recursive:true,force:true});}
});

test('file action identity recognizes equivalent normalized workspace paths',()=>{
 const {write}=fileCapabilities(value=>value,()=>true,()=>16),work={workingDirectory:'/workspace'};
 assert.equal(write.sameAction({path:'./sample',content:'one'},{path:'/workspace/sample',content:'one'},work),true);
 assert.equal(write.sameAction({path:'sample',content:'one'},{path:'sample',content:'two'},work),false);
 const isolated=isolatedFileCapabilities({workspace:'/workspace',recheck(){}},value=>value,()=>true,()=>16);
 assert.equal(isolated.write.sameAction({path:'./sample',content:'one'},{path:'/workspace/sample',content:'one'},{workingDirectory:'/private-data'}),true);
});

test('service checks worker read context before releasing a random page',()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-file-context-')),secret='synthetic-secret-credential';
 try {
  writeFileSync(join(root,'sample'),'prefix '+secret+' suffix');
  const raw=executeFileOperation(root,{kind:'read',path:'sample',offset:12,limit:5,overlap:Buffer.byteLength(secret)});
  assert.throws(()=>validateFilePage({buffer:Buffer.from(raw.data,'base64'),start:raw.start,index:raw.index,offset:12,limit:5,overlap:Buffer.byteLength(secret),redact:redactor({OPENROUTER_API_KEY:secret})}),/Action failed/);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('worker page validation rejects an unresolved long token boundary',()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-file-token-'));
 try {
  writeFileSync(join(root,'sample'),'sk-or-v1-'+ 'x'.repeat(70000)+' end');
  const raw=executeFileOperation(root,{kind:'read',path:'sample',offset:68000,limit:8,overlap:16});
  assert.throws(()=>validateFilePage({buffer:Buffer.from(raw.data,'base64'),start:raw.start,index:raw.index,offset:68000,limit:8,overlap:16,redact:redactor({})}),/Action failed/);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('file worker rejects traversal and symlinks outside its workspace',()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-file-worker-')),other=mkdtempSync(join(tmpdir(),'staf-file-other-'));
 try {writeFileSync(join(other,'private'),'synthetic');symlinkSync(join(other,'private'),join(root,'link'));for(const path of ['../private','link'])assert.throws(()=>executeFileOperation(root,{kind:'read',path,offset:0,limit:8,overlap:16}));}
 finally {rmSync(root,{recursive:true,force:true});rmSync(other,{recursive:true,force:true});}
});
