import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startInstance } from '../dist/instance-service.js';

test('direct file edits become visible and preserve previously observed configuration', async () => {
  const {writeFile,readdir}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-direct-edit-')),path=join(dir,'db');let app=startInstance(path),port=await app.listen(),token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const agent=(await call('/api/bots',{name:'Ada',instructions:'Original'}))[1],file=join(agent.configDir,'agent.toml');
    const original=await readFile(file,'utf8');
    await writeFile(file,original.replace('name = "Ada"','name = "Ada Test"'));
    const edited=await call(`/api/bots/${agent.id}`);assert.equal(edited[0],200);assert.equal(edited[1].name,'Ada Test');
    assert.equal((await call(`/api/bots/${agent.id}/profile`,{...agent,name:'Stale GUI'}))[0],409);
    assert.equal(await readFile(join(agent.configDir,'.published','agent.toml'),'utf8'),original);
    await writeFile(file,original.replace('name = "Ada"','name = "Ada Again"'));
    assert.equal((await call(`/api/bots/${agent.id}`))[1].name,'Ada Again');
    const history=join(agent.configDir,'.history');
    const snapshots=await Promise.all((await readdir(history)).map(name=>readFile(join(history,name,'agent.toml'),'utf8')));
    assert.ok(snapshots.some(text=>text.includes('name = "Ada Test"')));
    await app.close();app=startInstance(path);port=await app.listen();
    assert.equal((await call(`/api/bots/${agent.id}`))[1].name,'Ada Again');
    const afterRestart=await Promise.all((await readdir(history)).map(name=>readFile(join(history,name,'agent.toml'),'utf8')));
    assert.ok(afterRestart.some(text=>text.includes('name = "Ada Test"')));
    await writeFile(file,original);
    const restored=(await call(`/api/bots/${agent.id}`))[1];assert.notEqual(restored.revision,agent.revision);
    assert.equal((await call(`/api/bots/${agent.id}/profile`,{...agent,name:'Old draft'}))[0],409);
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});

test('observed direct changes keep stale clients stale even with coarse file timestamps', async () => {
  const fs=(await import('node:fs')).default,{syncBuiltinESMExports}=await import('node:module');
  const {writeFile,readdir}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'staf-config-coarse-'));
  const app=startInstance(join(dir,'db'));const port=await app.listen();let token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  const originalStat=fs.statSync;
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const agent=(await call('/api/bots',{name:'Ada',instructions:'A'}))[1],file=join(agent.configDir,'soul.md');
    fs.statSync=(path,options)=>{const result=originalStat(path,options);if(options?.bigint && /(?:agent\.toml|soul\.md)$/.test(String(path)))return {...result,ctimeNs:0n,mtimeNs:0n};return result;};syncBuiltinESMExports();
    const initial=(await call(`/api/bots/${agent.id}`))[1];
    await writeFile(file,'B');assert.equal((await call(`/api/bots/${agent.id}`))[1].instructions,'B');
    const history=join(agent.configDir,'.history'),count=(await readdir(history)).length;
    await writeFile(file,'B');assert.equal((await call(`/api/bots/${agent.id}`))[1].instructions,'B');
    assert.equal((await readdir(history)).length,count,'repeated identical saves do not duplicate recovery copies');
    await writeFile(file,'A');const restored=(await call(`/api/bots/${agent.id}`))[1];
    assert.notEqual(restored.revision,initial.revision);
    assert.equal((await call(`/api/bots/${agent.id}/profile`,{...initial,instructions:'stale'}))[0],409);
  } finally {fs.statSync=originalStat;syncBuiltinESMExports();await app.close();await rm(dir,{recursive:true,force:true});}
});

test('fresh service exposes the authoritative agent configuration files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'staf-agent-config-'));
  const app = startInstance(join(dir, 'instance.sqlite'));
  const port = await app.listen();
  const base = `http://127.0.0.1:${port}`;
  async function call(path, body, token) {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    assert.ok(response.ok, `${path}: ${response.status}`);
    return response.json();
  }
  try {
    const { token } = await call('/api/pair', { code: app.code });
    const agent = await call('/api/bots', { name: 'Ada', instructions: 'Explain clearly' }, token);
    const config = await call(`/api/bots/${agent.id}`, undefined, token);
    assert.equal('soul' in config, false);
    assert.equal(typeof config.configDir, 'string', 'agent configuration directory should be discoverable');
    assert.match(await readFile(join(config.configDir, 'agent.toml'), 'utf8'), /Ada/);
    assert.match(await readFile(join(config.configDir, 'soul.md'), 'utf8'), /Explain clearly/);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('service and direct file edits share a stable, validated configuration across restart', async () => {
  const { writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'staf-config-roundtrip-'));
  const path = join(dir, 'instance.sqlite');
  let app = startInstance(path), port = await app.listen(), token;
  const call = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return [response.status, await response.json()];
  };
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const agent=(await call('/api/bots',{name:'Ada',instructions:'Initial'}))[1];
    const other=(await call('/api/bots',{name:'Other'}))[1];
    const edited=(await call(`/api/bots/${agent.id}/profile`,{...agent,name:'Renamed',instructions:'From API'}))[1];
    assert.equal((await call(`/api/bots/${agent.id}/profile`,{...edited,soul:'A competing document'}))[0],400);
    assert.equal(edited.configDir,agent.configDir);
    assert.equal(await readFile(join(agent.configDir,'soul.md'),'utf8'),'From API');
    assert.match(await readFile(join(agent.configDir,'agent.toml'),'utf8'),/Renamed/);
    await writeFile(join(agent.configDir,'soul.md'),'Edited on disk');
    const structured=await readFile(join(agent.configDir,'agent.toml'),'utf8');
    await writeFile(join(agent.configDir,'agent.toml'),structured.replace('name = "Renamed"','name = "Edited on disk"'));
    const onDisk=(await call(`/api/bots/${agent.id}`))[1];
    assert.equal(onDisk.instructions,'Edited on disk');
    assert.equal(onDisk.name,'Edited on disk');
    assert.notEqual(onDisk.revision,edited.revision);
    assert.equal((await call(`/api/bots/${agent.id}/profile`,{...edited,instructions:'Stale'}))[0],409);
    await app.close(); app=startInstance(path);port=await app.listen();
    assert.equal((await call(`/api/bots/${agent.id}`))[1].instructions,'Edited on disk');
    assert.equal((await call(`/api/bots/${agent.id}`))[1].name,'Edited on disk');
    await writeFile(join(agent.configDir,'agent.toml'),'name = [broken');
    const listed=(await call('/api/bots'))[1];
    assert.match(listed.find(item=>item.id===agent.id).configError,/Invalid configuration/);
    assert.equal(listed.find(item=>item.id===other.id).name,'Other');
    assert.equal((await call('/api/commands',{id:'bad',botId:agent.id,content:'hello'}))[0],422);
    assert.equal((await call('/api/commands',{id:'good',botId:other.id,content:'hello'}))[1].kind,'accepted');
    assert.deepEqual((await call(`/api/bots/${agent.id}/messages`))[1],[]);
    assert.equal(await readFile(join(agent.configDir,'agent.toml'),'utf8'),'name = [broken');
  } finally { await app.close(); await rm(dir,{recursive:true,force:true}); }
});

test('a failed service publication retains the previously accepted file pair', async () => {
  const fs = (await import('node:fs')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-interrupt-'));
  const path=join(dir,'db');let app=startInstance(path),port=await app.listen(),token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  const original=fs.renameSync;
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const before=(await call('/api/bots',{name:'Before',instructions:'Before instructions'}))[1];
    fs.renameSync=(from,to)=>{if(String(to)===before.configDir)throw Error('synthetic interrupted publication');return original(from,to)};
    syncBuiltinESMExports();
    const failed=await call(`/api/bots/${before.id}/profile`,{...before,name:'After',instructions:'After instructions'});
    assert.equal(failed[0],503);
    fs.renameSync=original;syncBuiltinESMExports();
    await app.close();app=startInstance(path);port=await app.listen();
    const after=(await call(`/api/bots/${before.id}`))[1];
    assert.equal(after.name,'Before');assert.equal(after.instructions,'Before instructions');assert.equal(after.revision,before.revision);
    assert.match(await readFile(join(before.configDir,'agent.toml'),'utf8'),/Before/);
    assert.equal(await readFile(join(before.configDir,'soul.md'),'utf8'),'Before instructions');
  } finally {fs.renameSync=original;syncBuiltinESMExports();await app.close();await rm(dir,{recursive:true,force:true});}
});

test('actual paired CLI inspects and edits the same files as direct file changes', async () => {
  const { writeFile } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile), dir=await mkdtemp(join(tmpdir(),'staf-config-cli-'));
  const app=startInstance(join(dir,'db'));const port=await app.listen();
  const url=`http://127.0.0.1:${port}`,credential=join(dir,'client.json');
  const cli=async(...args)=>(await exec(process.execPath,['dist/cli.js','instance',...args])).stdout;
  try {
    await cli('pair',url,credential,app.code);
    const agent=JSON.parse(await cli('create',url,credential,'Ada','--instructions','From CLI'));
    assert.equal(await readFile(join(agent.configDir,'soul.md'),'utf8'),'From CLI');
    await writeFile(join(agent.configDir,'soul.md'),'From disk');
    const inspected=JSON.parse(await cli('inspect',url,credential,agent.id));
    assert.equal(inspected.instructions,'From disk');
    const input=join(dir,'edit.json');await writeFile(input,JSON.stringify({...inspected,name:'Ada renamed',instructions:'Saved by CLI'}));
    const updated=JSON.parse(await cli('edit',url,credential,agent.id,input));
    assert.equal(updated.configDir,agent.configDir);
    assert.equal(await readFile(join(agent.configDir,'soul.md'),'utf8'),'Saved by CLI');
    assert.match(await readFile(join(agent.configDir,'agent.toml'),'utf8'),/Ada renamed/);
    const staleDraft=JSON.stringify({...inspected,name:'Stale CLI draft',instructions:'Keep this text'});
    await writeFile(input,staleDraft);
    await assert.rejects(cli('edit',url,credential,agent.id,input));
    assert.equal(await readFile(input,'utf8'),staleDraft);
    assert.equal((JSON.parse(await cli('inspect',url,credential,agent.id))).instructions,'Saved by CLI');
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});

test('simultaneous service saves preserve the losing draft and only one version is published', async () => {
  const dir=await mkdtemp(join(tmpdir(),'staf-config-concurrent-'));
  const app=startInstance(join(dir,'db'));const port=await app.listen();let token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const agent=(await call('/api/bots',{name:'Ada',instructions:'Original'}))[1];
    const drafts=['First edit','Second edit'].map(instructions=>({...agent,instructions}));
    const results=await Promise.all(drafts.map(draft=>call(`/api/bots/${agent.id}/profile`,draft)));
    assert.deepEqual(results.map(result=>result[0]).sort(),[200,409]);
    const winner=results.findIndex(result=>result[0]===200),loser=1-winner;
    assert.equal((await call(`/api/bots/${agent.id}`))[1].instructions,drafts[winner].instructions);
    assert.equal(drafts[loser].instructions,['First edit','Second edit'][loser]);
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});

test('old revisions stay stale after settings or archive state return to earlier values', async () => {
  const dir=await mkdtemp(join(tmpdir(),'staf-config-aba-'));const app=startInstance(join(dir,'db'));const port=await app.listen();let token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const a=(await call('/api/bots',{name:'Ada',instructions:'A'}))[1];
    const b=(await call(`/api/bots/${a.id}/profile`,{...a,instructions:'B'}))[1];
    const again=(await call(`/api/bots/${a.id}/profile`,{...b,instructions:'A'}))[1];
    assert.notEqual(again.revision,a.revision);
    assert.equal((await call(`/api/bots/${a.id}/profile`,{...a,instructions:'stale'}))[0],409);
    const archived=(await call(`/api/bots/${a.id}/archive`,{revision:again.revision}))[1];
    const restored=(await call(`/api/bots/${a.id}/restore`,{revision:archived.revision}))[1];
    assert.notEqual(restored.revision,again.revision);
    assert.equal((await call(`/api/bots/${a.id}/profile`,{...again,instructions:'stale after restore'}))[0],409);
    assert.equal((await call(`/api/bots/${a.id}`))[1].instructions,'A');
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});

test('accepted work keeps its captured instructions even if files change or become invalid', async () => {
  const { writeFile }=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-capture-'));
  let entered,release;const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve}),seen=[];
  const providerFactory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(){seen.push(profile.instructions);entered();await gate;return {role:'assistant',content:'done'};}});
  const app=startInstance(join(dir,'db'),0,{providerFactory});const port=await app.listen();let token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const agent=(await call('/api/bots',{name:'Ada',instructions:'Captured'}))[1];
    assert.equal((await call('/api/commands',{id:'first',botId:agent.id,content:'hello'}))[1].kind,'accepted');await started;
    await writeFile(join(agent.configDir,'soul.md'),'Changed');
    const originalToml=await readFile(join(agent.configDir,'agent.toml'),'utf8');
    await writeFile(join(agent.configDir,'agent.toml'),'invalid = [');
    release();let command;for(let i=0;i<100;i++){command=(await call('/api/commands/first'))[1];if(command.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(command.state,'completed');assert.deepEqual(seen,['Captured']);
    assert.equal((await call('/api/commands',{id:'second',botId:agent.id,content:'hello again'}))[0],422);
    await writeFile(join(agent.configDir,'agent.toml'),originalToml);
    assert.equal((await call('/api/commands',{id:'third',botId:agent.id,content:'after repair'}))[1].kind,'accepted');
    for(let i=0;i<100;i++){command=(await call('/api/commands/third'))[1];if(command.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(command.state,'completed');assert.deepEqual(seen,['Captured','Changed']);
  } finally {release();await app.close();await rm(dir,{recursive:true,force:true});}
});

test('invalid main-agent files leave its conversation accessible', async () => {
  const {writeFile}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-main-'));const app=startInstance(join(dir,'db'));const port=await app.listen();let token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  try{
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const agent=(await call('/api/main-bot',{}))[1];
    await writeFile(join(agent.configDir,'agent.toml'),'bad = [');
    const [status,main]=await call('/api/main-bot',{});assert.equal(status,200);assert.match(main.configError,/Invalid configuration/);
    assert.equal((await call(`/api/bots/${agent.id}/messages`))[0],200);
    assert.equal((await call('/api/commands',{id:'blocked',botId:agent.id,content:'hello'}))[0],422);
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});

test('a direct edit during publication is preserved and the client save conflicts', async () => {
  const fs=(await import('node:fs')).default;const {syncBuiltinESMExports}=await import('node:module');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-race-'));const app=startInstance(join(dir,'db'));const port=await app.listen();let token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  const original=fs.symlinkSync;let injected=false;
  try{
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const before=(await call('/api/bots',{name:'Ada',instructions:'Original'}))[1];
    fs.symlinkSync=(target,path,type)=>{if(!injected&&String(path).includes('.current-')){injected=true;fs.writeFileSync(join(before.configDir,'soul.md'),'Direct edit');}return original(target,path,type);};syncBuiltinESMExports();
    const result=await call(`/api/bots/${before.id}/profile`,{...before,name:'API edit'});
    fs.symlinkSync=original;syncBuiltinESMExports();
    assert.equal(injected,true);assert.equal(result[0],409);
    assert.equal(await readFile(join(before.configDir,'soul.md'),'utf8'),'Direct edit');
    const current=(await call(`/api/bots/${before.id}`))[1];assert.equal(current.name,'Ada');assert.equal(current.instructions,'Direct edit');
  }finally{fs.symlinkSync=original;syncBuiltinESMExports();await app.close();await rm(dir,{recursive:true,force:true});}
});

test('a late write to the previous file is retained and blocks new work for review', async () => {
  const {open,realpath,unlink,writeFile}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-late-')),path=join(dir,'db');let app=startInstance(path),port=await app.listen(),token,handle;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  try{
    token=(await call('/api/pair',{code:app.code}))[1].token;const before=(await call('/api/bots',{name:'Ada',instructions:'Original'}))[1];
    const oldDir=await realpath(before.configDir);handle=await open(join(before.configDir,'soul.md'),'r+');
    assert.equal((await call(`/api/bots/${before.id}/profile`,{...before,name:'API edit'}))[0],200);
    await handle.truncate(0);await handle.write('Late edit',0,'utf8');await handle.sync();await handle.close();handle=undefined;
    await app.close();app=startInstance(path);port=await app.listen();
    const status=await call(`/api/bots/${before.id}`);assert.equal(status[0],422);assert.match(status[1].error,/previous revision/);
    assert.equal(await readFile(join(oldDir,'soul.md'),'utf8'),'Late edit');
    assert.equal((await call('/api/commands',{id:'blocked',botId:before.id,content:'hello'}))[0],422);
    await unlink(join(oldDir,'.retired'));
    const current=(await call(`/api/bots/${before.id}`))[1];
    assert.equal((await call(`/api/bots/${before.id}/profile`,{...current,instructions:'Late edit'}))[1].instructions,'Late edit');
  }finally{await handle?.close();await app.close();await rm(dir,{recursive:true,force:true});}
});

test('an edit to the briefly published revision is retained if publication rolls back', async () => {
  const fs=(await import('node:fs')).default;const {syncBuiltinESMExports}=await import('node:module');const {realpath}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-rollback-'));const app=startInstance(join(dir,'db'));const port=await app.listen();let token,fd,newDir;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  const original=fs.renameSync;let injected=false;
  try{
    token=(await call('/api/pair',{code:app.code}))[1].token;const before=(await call('/api/bots',{name:'Ada',instructions:'Original'}))[1];const oldDir=await realpath(before.configDir);
    fs.renameSync=(from,to)=>{const result=original(from,to);if(!injected&&String(to)===before.configDir){injected=true;newDir=fs.realpathSync(before.configDir);fd=fs.openSync(join(newDir,'soul.md'),'r+');fs.writeFileSync(join(oldDir,'soul.md'),'Old edit');}return result;};syncBuiltinESMExports();
    const result=await call(`/api/bots/${before.id}/profile`,{...before,name:'API edit'});
    fs.renameSync=original;syncBuiltinESMExports();assert.equal(injected,true);assert.equal(result[0],409);
    fs.ftruncateSync(fd,0);fs.writeSync(fd,'New edit',0,'utf8');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    const inspected=await call(`/api/bots/${before.id}`);assert.equal(inspected[0],422);assert.match(inspected[1].error,/previous revision/);
    assert.equal(await readFile(join(oldDir,'soul.md'),'utf8'),'Old edit');assert.equal(await readFile(join(newDir,'soul.md'),'utf8'),'New edit');
  }finally{if(fd!==undefined)fs.closeSync(fd);fs.renameSync=original;syncBuiltinESMExports();await app.close();await rm(dir,{recursive:true,force:true});}
});

test('an error after the publication switch reports an uncertain outcome', async () => {
  const fs=(await import('node:fs')).default;const {syncBuiltinESMExports}=await import('node:module');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-uncertain-'));const app=startInstance(join(dir,'db'));const port=await app.listen();let token,armed=false;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  const originalRename=fs.renameSync,originalSync=fs.fsyncSync;
  try{
    token=(await call('/api/pair',{code:app.code}))[1].token;const before=(await call('/api/bots',{name:'Before',instructions:'Before instructions'}))[1];
    fs.renameSync=(from,to)=>{const result=originalRename(from,to);if(String(to)===before.configDir)armed=true;return result;};
    fs.fsyncSync=fd=>{if(armed){armed=false;throw Error('synthetic directory sync failure');}return originalSync(fd);};syncBuiltinESMExports();
    const result=await call(`/api/bots/${before.id}/profile`,{...before,name:'After',instructions:'After instructions'});
    fs.renameSync=originalRename;fs.fsyncSync=originalSync;syncBuiltinESMExports();
    assert.equal(result[0],503);assert.match(result[1].error,/may have taken effect/);
    const after=(await call(`/api/bots/${before.id}`))[1];assert.equal(after.name,'After');assert.equal(after.instructions,'After instructions');
  }finally{fs.renameSync=originalRename;fs.fsyncSync=originalSync;syncBuiltinESMExports();await app.close();await rm(dir,{recursive:true,force:true});}
});

test('a late edit discovered after publication reports that the save may have taken effect', async () => {
  const fs=(await import('node:fs')).default;const {syncBuiltinESMExports}=await import('node:module');const {realpath}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-postcheck-'));const app=startInstance(join(dir,'db'));const port=await app.listen();let token,switched=false,injected=false;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  const originalRename=fs.renameSync,originalReadDir=fs.readdirSync;
  try{
    token=(await call('/api/pair',{code:app.code}))[1].token;const before=(await call('/api/bots',{name:'Before',instructions:'Before'}))[1],oldDir=await realpath(before.configDir);
    fs.renameSync=(from,to)=>{const result=originalRename(from,to);if(String(to)===before.configDir)switched=true;return result;};
    fs.readdirSync=(path,options)=>{if(switched&&!injected){injected=true;fs.writeFileSync(join(oldDir,'soul.md'),'Late edit');}return originalReadDir(path,options);};syncBuiltinESMExports();
    const result=await call(`/api/bots/${before.id}/profile`,{...before,name:'After',instructions:'After'});
    fs.renameSync=originalRename;fs.readdirSync=originalReadDir;syncBuiltinESMExports();
    assert.equal(injected,true);assert.equal(result[0],503);assert.match(result[1].error,/may have taken effect/);assert.match(result[1].error,/previous revision/);
    assert.equal(await readFile(join(before.configDir,'soul.md'),'utf8'),'After');assert.equal(await readFile(join(oldDir,'soul.md'),'utf8'),'Late edit');
  }finally{fs.renameSync=originalRename;fs.readdirSync=originalReadDir;syncBuiltinESMExports();await app.close();await rm(dir,{recursive:true,force:true});}
});

test('background work captures instructions when accepted', async () => {
  const dir=await mkdtemp(join(tmpdir(),'staf-config-task-'));let entered,release,calls=0;const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve}),seen=[];
  const providerFactory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(){seen.push(profile.instructions);if(++calls===1){entered();await gate;}return {role:'assistant',content:'done'};}});
  const app=startInstance(join(dir,'db'),0,{providerFactory});const port=await app.listen();let token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  const completed=async id=>{for(let i=0;i<100;i++){const result=(await call(`/api/tasks/${id}`))[1];if(result.state!=='queued'&&result.state!=='running')return result;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Task timed out');};
  try{
    token=(await call('/api/pair',{code:app.code}))[1].token;const agent=(await call('/api/bots',{name:'Ada',instructions:'Before'}))[1];
    assert.equal((await call('/api/tasks',{id:'first-task',botId:agent.id,objective:'First'}))[1].kind,'accepted');await started;
    assert.equal((await call(`/api/bots/${agent.id}/profile`,{...agent,instructions:'After'}))[0],200);
    release();assert.equal((await completed('first-task')).state,'completed');
    assert.equal((await call('/api/tasks',{id:'second-task',botId:agent.id,objective:'Second'}))[1].kind,'accepted');
    assert.equal((await completed('second-task')).state,'completed');assert.deepEqual(seen,['Before','After']);
  }finally{release();await app.close();await rm(dir,{recursive:true,force:true});}
});

test('a later direct pathname save takes effect and retains the previous client save', async () => {
  const { writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'staf-config-stale-editor-'));
  const path=join(dir,'db');let app = startInstance(path);
  let port = await app.listen();
  let token;
  const call = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return [response.status, await response.json()];
  };
  try {
    token = (await call('/api/pair', { code: app.code }))[1].token;
    const agent = (await call('/api/bots', { name: 'Ada', instructions: 'Original' }))[1];
    const file = join(agent.configDir, 'soul.md');
    const staleBuffer = await readFile(file, 'utf8');
    const saved = await call(`/api/bots/${agent.id}/profile`, { ...agent, instructions: 'Client save' });
    assert.equal(saved[0], 200);
    await writeFile(file, `${staleBuffer} plus editor change`);
    await app.close();app=startInstance(path);port=await app.listen();
    const inspection = await call(`/api/bots/${agent.id}`);
    assert.equal(inspection[0], 200);
    assert.equal(inspection[1].instructions,`${staleBuffer} plus editor change`);
    assert.equal(await readFile(file, 'utf8'), `${staleBuffer} plus editor change`);
    assert.equal(await readFile(join(agent.configDir, '.published', 'soul.md'), 'utf8'), 'Client save');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a missing published snapshot cannot silently adopt changed files', async () => {
  const {rename,writeFile}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-missing-snapshot-'));
  const app=startInstance(join(dir,'db'));const port=await app.listen();let token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const agent=(await call('/api/bots',{name:'Ada',instructions:'Published'}))[1];
    await rename(join(agent.configDir,'.published'),join(agent.configDir,'.published-backup'));
    await writeFile(join(agent.configDir,'soul.md'),'Unexpected edit');
    const result=await call(`/api/bots/${agent.id}`);assert.equal(result[0],422);assert.match(result[1].error,/snapshot is missing/);
    await rename(join(agent.configDir,'.published-backup'),join(agent.configDir,'.published'));
    await writeFile(join(agent.configDir,'soul.md'),'Published');
    assert.equal((await call(`/api/bots/${agent.id}`))[1].instructions,'Published');
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});

test('invalid UTF-8 in a published file is rejected even when it decodes like the old text', async () => {
  const {writeFile}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'staf-config-utf8-'));
  const app=startInstance(join(dir,'db'));const port=await app.listen();let token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const agent=(await call('/api/bots',{name:'Ada',instructions:'a\ufffdb'}))[1],file=join(agent.configDir,'soul.md'),bad=Buffer.from([0x61,0xff,0x62]);
    await writeFile(file,bad);
    const result=await call(`/api/bots/${agent.id}`);assert.equal(result[0],422);assert.match(result[1].error,/valid UTF-8/);assert.deepEqual(await readFile(file),bad);
    await writeFile(file,'a\ufffdb');
    const repaired=(await call(`/api/bots/${agent.id}`))[1];
    assert.equal((await call(`/api/bots/${agent.id}/profile`,{...repaired,instructions:'\ud800'}))[0],400);
    assert.equal((await call(`/api/bots/${agent.id}`))[1].instructions,'a\ufffdb');
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});

test('an existing file configuration is sealed on startup before client access', async () => {
  const {writeFile}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-upgrade-')),path=join(dir,'db');
  let app=startInstance(path),port=await app.listen(),token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const agent=(await call('/api/bots',{name:'Ada',instructions:'Existing'}))[1];
    await app.close();
    await rm(join(agent.configDir,'.published'),{recursive:true});await rm(join(agent.configDir,'.sealed'));
    app=startInstance(path);port=await app.listen();
    assert.equal(await readFile(join(agent.configDir,'.published','soul.md'),'utf8'),'Existing');
    await writeFile(join(agent.configDir,'soul.md'),'Uncoordinated edit');
    assert.equal((await call(`/api/bots/${agent.id}`))[1].instructions,'Uncoordinated edit');
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});

test('previously retired revisions keep their legacy hash across upgrade', async () => {
  const {realpath,writeFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-legacy-hash-')),path=join(dir,'db');
  let app=startInstance(path),port=await app.listen(),token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const agent=(await call('/api/bots',{name:'Ada',instructions:'First'}))[1],old=await realpath(agent.configDir);
    const settings=await readFile(join(old,'agent.toml'),'utf8'),soul=await readFile(join(old,'soul.md'),'utf8');
    assert.equal((await call(`/api/bots/${agent.id}/profile`,{...agent,instructions:'Second'}))[0],200);
    const revision=createHash('sha256').update(settings).update('\0').update(soul).update('\0').digest('hex');
    await writeFile(join(old,'.retired'),JSON.stringify({revision,archived:false}));
    await app.close();app=startInstance(path);port=await app.listen();
    assert.equal((await call(`/api/bots/${agent.id}`))[1].instructions,'Second');
    await writeFile(join(old,'soul.md'),'Late legacy edit');
    assert.equal((await call(`/api/bots/${agent.id}`))[0],422);
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});

test('a copied instance can read unchanged retained revisions', async () => {
  const {cp,mkdir}=await import('node:fs/promises');
  const root=await mkdtemp(join(tmpdir(),'staf-config-copy-')),source=join(root,'source'),copy=join(root,'copy');await mkdir(source);
  let app=startInstance(join(source,'db')),port=await app.listen(),token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const agent=(await call('/api/bots',{name:'Ada',instructions:'First'}))[1];
    assert.equal((await call(`/api/bots/${agent.id}/profile`,{...agent,instructions:'Second'}))[0],200);
    await app.close();await cp(source,copy,{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});
    app=startInstance(join(copy,'db'));port=await app.listen();
    const restored=await call(`/api/bots/${agent.id}`);assert.equal(restored[0],200);assert.equal(restored[1].instructions,'Second');
  } finally {await app.close();await rm(root,{recursive:true,force:true});}
});

test('service file publication preserves authored TOML when editing instructions', async () => {
  const {writeFile}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-comments-'));
  const app=startInstance(join(dir,'db'));const port=await app.listen();let token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const agent=(await call('/api/bots',{name:'Ada',instructions:'Original'}))[1];
    const file=join(agent.configDir,'agent.toml'),settings='# Owner comment\n'+await readFile(file,'utf8');
    await writeFile(file,settings);const published=await call(`/api/bots/${agent.id}`);assert.equal(published[0],200);
    const edited=await call(`/api/bots/${agent.id}/profile`,{...published[1],instructions:'Updated instructions'});assert.equal(edited[0],200);
    assert.equal(await readFile(file,'utf8'),settings);
    const changed=await call(`/api/bots/${agent.id}/profile`,{...edited[1],name:'Changed'});
    assert.equal(changed[0],200);
    assert.equal(await readFile(file,'utf8'),settings.replace('name = "Ada"','name = "Changed"'));
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});

test('GUI-style settings saves retain TOML comments and multiline values', async () => {
  const {writeFile}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'staf-config-formatting-'));const app=startInstance(join(dir,'db'));const port=await app.listen();let token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  try {
    token=(await call('/api/pair',{code:app.code}))[1].token;
    const agent=(await call('/api/bots',{name:'Ada',instructions:'Soul'}))[1];
    const settings=`# Preserve this comment\n"name" = 'Ada' # name note\ndescription = """First line\n# Text inside the value\nLast line"""\nprovider = 'demo' # provider note\nmodel = 'old#model' # model note\n`;
    const file=join(agent.configDir,'agent.toml');await writeFile(file,settings);
    const published=await call(`/api/bots/${agent.id}`);assert.equal(published[0],200);
    const edited=await call(`/api/bots/${agent.id}/profile`,{...published[1],name:'New Ada',model:null});assert.equal(edited[0],200);
    const after=await readFile(file,'utf8');
    assert.match(after,/# Preserve this comment/);assert.match(after,/# name note/);assert.match(after,/# provider note/);assert.match(after,/# model note/);
    assert.match(after,/description = """First line\n# Text inside the value\nLast line"""/);
    assert.equal((await call(`/api/bots/${agent.id}`))[1].name,'New Ada');
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});

test('the paired CLI observes direct Unicode edits and reports invalid UTF-8', async () => {
  const {writeFile}=await import('node:fs/promises');
  const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const exec=promisify(execFile);
  const dir=await mkdtemp(join(tmpdir(),'staf-direct-cli-'));const app=startInstance(join(dir,'db'));const port=await app.listen();
  const url=`http://127.0.0.1:${port}`,credential=join(dir,'client.json');
  const cli=async(...args)=>(await exec(process.execPath,['dist/cli.js','instance',...args])).stdout;
  try {
    await cli('pair',url,credential,app.code);
    const agent=JSON.parse(await cli('create',url,credential,'Ada','--instructions','Original'));
    const file=join(agent.configDir,'soul.md'),longSoul='界'.repeat(25000);
    await writeFile(file,longSoul);
    assert.equal(JSON.parse(await cli('inspect',url,credential,agent.id)).instructions,longSoul);
    const bytes=Buffer.from([0x61,0xff,0x62]);await writeFile(file,bytes);
    await assert.rejects(cli('inspect',url,credential,agent.id),error=>{assert.match(error.stderr,/valid UTF-8/);return true});
    assert.deepEqual(await readFile(file),bytes);
    await writeFile(file,longSoul);
    assert.equal(JSON.parse(await cli('inspect',url,credential,agent.id)).instructions,longSoul);
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});
