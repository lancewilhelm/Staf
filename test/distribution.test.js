import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('package excludes synthetic developer settings/auth/env and fresh extracted CLI uses product defaults',async t=>{
 const {packageManager}=JSON.parse(await readFile('package.json','utf8'));
 const root=await mkdtemp(join(tmpdir(),'staf-distribution-'));t.after(async()=>{try{const descriptor=JSON.parse(await readFile(join(root,'fresh-data','terminal-service.json'),'utf8'));process.kill(descriptor.pid,'SIGTERM');await new Promise(resolve=>setTimeout(resolve,250));}catch{}await rm(root,{recursive:true,force:true});});
 const project=join(root,'development');await mkdir(project);
 // Copy only explicitly shipped code/docs, never the real user's runtime data.
 for(const name of ['src','dist','test','docs','package.json','tsconfig.json','pnpm-lock.yaml','README.md','AGENTS.md','.env.example','.gitignore','.npmignore']) {
  await cp(name,join(project,name),{recursive:true});
 }
 await mkdir(join(project,'.staf','config'),{recursive:true});
 await writeFile(join(project,'.staf','config','settings.json'),JSON.stringify({version:1,defaults:{provider:'openrouter','model.openrouter':'developer-only-model'}}));
 await writeFile(join(project,'.staf','auth.json'),'dummy-private-auth');await writeFile(join(project,'.env'),'OPENROUTER_API_KEY=dummy-private-key');
 await writeFile(join(project,'.env.local'),'DUMMY_SECRET=private');await writeFile(join(project,'src','auth.json'),'dummy-private-auth');
 const pack=spawnSync('corepack',[packageManager,'pack','--pack-destination',root],{cwd:project,encoding:'utf8'});assert.equal(pack.status,0,pack.stdout+pack.stderr);
 const archive=(await readdir(root)).find(name=>name.endsWith('.tgz'));assert.ok(archive);
 const listing=spawnSync('tar',['-tzf',join(root,archive)],{encoding:'utf8'});assert.equal(listing.status,0);
 assert.ok(!listing.stdout.includes('.staf/'));assert.ok(!listing.stdout.split('\n').includes('package/.env'));assert.ok(!listing.stdout.includes('auth.json'));assert.ok(!listing.stdout.includes('codex-direct.json'));assert.ok(!listing.stdout.includes('codex-host.json'));assert.ok(!listing.stdout.includes('package/.env.local'));assert.ok(listing.stdout.includes('package/.env.example'));
 const fresh=join(root,'fresh');await mkdir(fresh);const unpack=spawnSync('tar',['-xzf',join(root,archive),'-C',fresh],{encoding:'utf8'});assert.equal(unpack.status,0);
 assert.ok(!listing.stdout.split('\n').includes('package/pnpm-lock.yaml'),'pnpm 12 excludes root lockfiles from packed packages');
 const install=spawnSync('corepack',[packageManager,'install','--offline','--prod','--no-frozen-lockfile'],{cwd:join(fresh,'package'),env:{...process.env,CI:'true'},encoding:'utf8'});assert.equal(install.status,0,install.stdout+install.stderr);
 assert.ok(listing.stdout.includes('package/dist/code-mode/worker.js'));
 const worker=spawnSync(process.execPath,['--input-type=module','-e',`import {startQuickJSGuest} from './dist/code-mode/executor.js'; const run=startQuickJSGuest({source:'return await capabilities.clock({})',names:['clock'],guestMs:5000,request:async()=>({ok:true,value:'ok'}),phase:()=>{}}); const result=await run.finished; if(result.outcome!=='return'||result.value!=='ok') process.exit(1);`],{cwd:join(fresh,'package'),encoding:'utf8'});
 assert.equal(worker.status,0,worker.stdout+worker.stderr);
 const data=join(root,'fresh-data');
 const shown=spawnSync(process.execPath,[join(fresh,'package','dist','cli.js'),'settings','show','--data-dir',data],{cwd:fresh,encoding:'utf8'});
 assert.equal(shown.status,0,shown.stderr);assert.match(shown.stdout,/Provider: demo/);assert.match(shown.stdout,/Model: \(provider default\)/);assert.ok(!shown.stdout.includes('developer-only-model'));
});
