import {execFileSync,fork,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=process.cwd(),require=createRequire(join(root,'package.json')),ts=require('typescript');
const temp=mkdtempSync(join(tmpdir(),'staf-actual-older-')),data=join(temp,'instance.sqlite');
const env={PATH:process.env.PATH,HOME:temp,TMPDIR:temp,STAF_DEV_DATA_DIR:temp};
const source=execFileSync('git',['show','d2ab6fc:src/instance.ts'],{encoding:'utf8'});
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/(from\s+['"])\.\/(.*?)(['"])/g,(_,a,b,c)=>a+pathToFileURL(resolve(root,'dist',b)).href+c);
writeFileSync(join(temp,'old-instance.mjs'),js);
writeFileSync(join(temp,'probe.mjs'),`import {Instance} from './old-instance.mjs';\ntry {const i=new Instance(process.argv[2]);i.close();console.error('UNEXPECTED START');process.exitCode=1;} catch(e) {console.log(e.message);if(!/locked|busy|newer/i.test(e.message))process.exitCode=2;}\n`);
const child=fork(join(root,'scripts/dev-data.mjs'),['reset'],{env:{...env,STAF_DEV_TEST_PAUSE:'database-published'},stdio:['ignore','ignore','pipe','ipc']});let err='';child.stderr.on('data',b=>err+=b);
try {
 await new Promise((yes,no)=>{child.once('message',yes);child.once('exit',()=>no(Error(err)));});
 for(const label of ['paused publication','after SIGKILL']) {
  if(label==='after SIGKILL'){child.kill('SIGKILL');await new Promise(yes=>child.once('exit',yes));}
  const p=spawnSync(process.execPath,[join(temp,'probe.mjs'),data],{env,encoding:'utf8'});if(p.status!==0)throw Error(`${label}: ${p.status} ${p.stdout} ${p.stderr}`);console.log(`${label}: ${p.stdout.trim()}`);
 }
 const recovery=spawnSync(process.execPath,[join(root,'scripts/dev-data.mjs'),'recover'],{env,encoding:'utf8'});if(recovery.status!==0)throw Error(recovery.stderr);
} finally {if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');rmSync(temp,{recursive:true,force:true});}
