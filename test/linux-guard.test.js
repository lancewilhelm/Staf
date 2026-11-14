import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';

const compilerProblem=(()=>{
  const dir=mkdtempSync(join(tmpdir(),'staf-cc-check-'));
  try {
    const result=spawnSync('cc',['-x','c','-','-o',join(dir,'check')],{input:'int main(void) { return 0; }\n',encoding:'utf8'});
    return result.status===0?false:'A working native C compiler and SDK are required';
  } finally {rmSync(dir,{recursive:true,force:true});}
})();

test('Linux guard mount admission rejects nested and ambiguous exports',{skip:compilerProblem}, () => {
  const dir=mkdtempSync(join(tmpdir(),'staf-mount-test-'));
  try {
    const source=join(dir,'mounts.c'),binary=join(dir,'mounts');
    writeFileSync(source,`#include "staf-exec-mountinfo.h"\nint main(void) { return staf_mounts_are_safe(stdin) ? 0 : 1; }\n`);
    const compile=spawnSync('cc',['-D_POSIX_C_SOURCE=200809L','-std=c11','-Wall','-Wextra','-Werror','-I',resolve('deploy/native-linux'),source,'-o',binary],{encoding:'utf8'});
    assert.equal(compile.status,0,compile.stderr);
    const mount=(id,path)=>`${id} 1 0:${id} / ${path} rw - tmpfs tmpfs rw\n`;
    const roots=mount(1,'/')+mount(2,'/usr')+mount(3,'/workspace');
    const accepts=input=>spawnSync(binary,[],{input,encoding:'utf8'}).status===0;
    assert.equal(accepts(roots+mount(4,'/dev')),true);
    assert.equal(accepts(roots+mount(4,'/workspace/nested')),false);
    assert.equal(accepts(roots+mount(4,'/usr/lib/secret')),false);
    assert.equal(accepts(roots+mount(4,'/workspace')),false);
    assert.equal(accepts(mount(1,'/')+mount(2,'/usr')),false);
    assert.equal(accepts(roots+'malformed\n'),false);
    assert.equal(accepts(roots+mount(4,'/workspace-other')),true);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

if(process.platform!=='linux')test('Linux guard and file opener fail closed on an unsupported host before reading input',{skip:compilerProblem}, () => {
  const dir=mkdtempSync(join(tmpdir(),'staf-guard-test-'));
  try {
    for(const source of ['staf-exec-guard.c','staf-file-open.c']) {
      const binary=join(dir,source);
      const compile=spawnSync('cc',['-std=c11','-Wall','-Wextra','-Werror','deploy/native-linux/'+source,'-o',binary],{encoding:'utf8'});
      assert.equal(compile.status,0,compile.stderr);
      const result=spawnSync(binary,[],{input:'synthetic command\n',encoding:'utf8'});
      assert.equal(result.status,125);assert.equal(result.stdout,'');assert.match(result.stderr,/unavailable/i);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
