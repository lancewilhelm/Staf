import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from './fixtures/controlled-instance.mjs';
import {PNG} from 'pngjs';
import {randomFillSync,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {agentImageBodyType,avatarSvg,agentImageColors,agentImageShapes} from '../dist/agent-image.js';
import {AgentImageAssets} from '../dist/agent-image-assets.js';

async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),'staf-images-')), path=join(dir,'instance.sqlite');
  let app=startInstance(path,0,{env:{}}), port=await app.listen();
  const call=async(route,body,tokenOverride=token,contentType='application/json')=>{
    const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(tokenOverride?{Authorization:`Bearer ${tokenOverride}`} : {}),...(body===undefined?{}:{'Content-Type':contentType})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json()};
  };
  let token='';
  token=(await call('/api/pair',{code:app.code})).body.token;
  const restart=async()=>{await app.close();app=startInstance(path,0,{env:{}});port=await app.listen();};
  try {await run({call,restart,dir,issueCode:()=>app.issueCode(),get port(){return port;},get token(){return token;}});}
  finally {await app.close();await rm(dir,{recursive:true,force:true});}
}

test('first upload directory publication must succeed before accepting crop bytes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'staf-image-durability-')),root=join(dir,'agents','.images');
  const sync=fs.fsyncSync;
  try {
    fs.fsyncSync=fd=>{
      if(fs.fstatSync(fd).ino===fs.statSync(join(dir,'agents')).ino)throw Error('synthetic parent directory sync failure');
      return sync(fd);
    };syncBuiltinESMExports();
    assert.throws(()=>new AgentImageAssets(root),/parent directory sync failure/);
    assert.deepEqual(fs.readdirSync(root),[],'no crop can be accepted before directory publication succeeds');
  } finally {fs.fsyncSync=sync;syncBuiltinESMExports();}
  try {
    const store=new AgentImageAssets(root),crop=new PNG({width:256,height:256});crop.data.fill(120);
    const accepted=store.accept({kind:'upload-data',png:PNG.sync.write(crop).toString('base64')});
    assert.ok(store.read(accepted.assetId),'retry publishes a readable crop');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('legacy agents use initials and image edits preserve identity through clients and restart',()=>fixture(async({call,restart})=>{
  const created=(await call('/api/bots',{name:'Ada',instructions:'Keep these instructions',provider:'live',model:'fixture-offline'})).body;
  assert.deepEqual(created.image,{kind:'initials'});
  const image={kind:'avatar',shape:'pentagon',color:'lilac'};
  const saved=await call(`/api/bots/${created.id}/profile`,{...created,image});
  assert.equal(saved.status,200);assert.deepEqual(saved.body.image,image);
  assert.equal((await call(`/api/bots/${created.id}/profile`,{...created,image:{kind:'initials'}})).status,409);
  const {image:omitted,...legacyEdit}=saved.body;
  const renamed=(await call(`/api/bots/${created.id}/profile`,{...legacyEdit,name:'Ada renamed'})).body;
  assert.deepEqual(renamed.image,image);
  const text=await readFile(join(renamed.configDir,'agent.toml'),'utf8');
  assert.match(text,/image = "avatar:pentagon:lilac"/);
  await writeFile(join(renamed.configDir,'agent.toml'),'# owner note\n'+text.replace('"avatar:pentagon:lilac"','"avatar:circle:sky" # chosen by owner'));
  const direct=(await call(`/api/bots/${created.id}`)).body;
  assert.deepEqual(direct.image,{kind:'avatar',shape:'circle',color:'sky'});
  const commented=(await call(`/api/bots/${created.id}/profile`,{...direct,image:{kind:'avatar',shape:'circle',color:'rose'}})).body;
  assert.match(await readFile(join(commented.configDir,'agent.toml'),'utf8'),/# owner note[\s\S]*image = "avatar:circle:rose" # chosen by owner/);
  await restart();
  const current=(await call(`/api/bots/${created.id}`)).body;
  assert.deepEqual(current.image,commented.image);assert.equal(current.instructions,'Keep these instructions');
  const archived=(await call(`/api/bots/${created.id}/archive`,{revision:current.revision})).body;
  const restored=(await call(`/api/bots/${created.id}/restore`,{revision:archived.revision})).body;
  assert.deepEqual(restored.image,current.image);
  assert.deepEqual((await call(`/api/bots/${created.id}/profile`,{...restored,image:{kind:'initials'}})).body.image,{kind:'initials'});
}));

test('uploaded crops are bounded, authenticated, immutable and retained through recovery and lifecycle',()=>fixture(async(ctx)=>{
  const image=new PNG({width:256,height:256});randomFillSync(image.data);
  const png=PNG.sync.write(image).toString('base64'),input={kind:'upload-data',png};
  const pending={operationId:'upload-create',name:'Photo',instructions:'Keep',provider:'live',model:'fixture-offline',image:input};
  assert.equal((await ctx.call('/api/bots',pending,'',agentImageBodyType)).status,401);
  assert.equal((await ctx.call('/api/bots',pending)).status,413,'ordinary JSON limit stays 64 KiB');
  const created=await ctx.call('/api/bots',pending,ctx.token,agentImageBodyType);
  assert.equal(created.status,201);assert.equal(created.body.image.kind,'upload');
  assert.match(created.body.image.assetId,/^[a-f0-9]{64}$/);assert.equal('png' in created.body.image,false);
  const asset=()=>`http://127.0.0.1:${ctx.port}/api/agent-images/${created.body.image.assetId}`;
  assert.equal((await fetch(asset())).status,401);
  assert.equal((await fetch(asset(),{headers:{Authorization:`Bearer ${ctx.token}`,Origin:'http://other.example'}})).status,403);
  let bytes=await fetch(asset(),{headers:{Authorization:`Bearer ${ctx.token}`}});
  assert.equal(bytes.headers.get('Content-Type'),'image/png');const saved=Buffer.from(await bytes.arrayBuffer());
  assert.deepEqual(PNG.sync.read(saved).data,image.data);
  assert.equal((await ctx.call('/api/bots',pending,ctx.token,agentImageBodyType)).body.id,created.body.id);
  const second=(await ctx.call('/api/pair',{code:ctx.issueCode()})).body.token;
  assert.deepEqual((await ctx.call(`/api/bots/${created.body.id}`,undefined,second)).body.image,created.body.image);
  const clients=(await ctx.call('/api/clients')).body;
  const secondClient=clients.find(client=>!client.current);
  assert.ok(secondClient);
  assert.equal((await ctx.call(`/api/clients/${secondClient.id}/revoke`,{})).status,200);
  assert.equal((await fetch(asset(),{headers:{Authorization:`Bearer ${second}`}})).status,401);
  const temporary=join(ctx.dir,'agents','.images','.upload-'+randomUUID());await writeFile(temporary,'interrupted stage');
  await ctx.restart();
  const afterRestart=await fetch(asset(),{headers:{Authorization:`Bearer ${ctx.token}`}});assert.equal(afterRestart.status,200);await afterRestart.arrayBuffer();
  await assert.rejects(readFile(temporary),{code:'ENOENT'});
  const current=(await ctx.call(`/api/bots/${created.body.id}`)).body;
  assert.deepEqual(current.image,created.body.image);
  const archived=(await ctx.call(`/api/bots/${current.id}/archive`,{revision:current.revision})).body;
  const restored=(await ctx.call(`/api/bots/${current.id}/restore`,{revision:archived.revision})).body;
  assert.deepEqual(restored.image,current.image);
  const changed=new PNG({width:256,height:256});changed.data.fill(160);
  const replaced=await ctx.call(`/api/bots/${current.id}/profile`,{...restored,image:{kind:'upload-data',png:PNG.sync.write(changed).toString('base64')}},ctx.token,agentImageBodyType);
  assert.equal(replaced.status,200);assert.notEqual(replaced.body.image.assetId,current.image.assetId);
  bytes=await fetch(asset(),{headers:{Authorization:`Bearer ${ctx.token}`}});
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),saved,'retained configurations keep their immutable asset');
  await rm(join(ctx.dir,'agents','.images',replaced.body.image.assetId+'.png'));
  assert.equal((await ctx.call('/api/agent-images/'+replaced.body.image.assetId)).status,404);
  assert.equal((await ctx.call(`/api/bots/${current.id}/messages`)).status,200,'missing image does not remove conversation access');
}));

test('the paired CLI edits and preserves shared image descriptors',()=>fixture(async(ctx)=>{
  const run=promisify(execFile),credential=join(ctx.dir,'client.json'),profileFile=join(ctx.dir,'profile.json');
  await writeFile(credential,JSON.stringify({token:ctx.token}),{mode:0o600});
  const cli=async(...args)=>JSON.parse((await run(process.execPath,['dist/cli.js','instance',...args])).stdout);
  const origin=`http://127.0.0.1:${ctx.port}`;
  const agent=(await ctx.call('/api/bots',{name:'CLI image',provider:'live',model:'fixture-offline'})).body;
  const profile=await cli('inspect',origin,credential,agent.id);
  await writeFile(profileFile,JSON.stringify({...profile,image:{kind:'avatar',shape:'capsule',color:'sage'}}));
  const edited=await cli('edit',origin,credential,agent.id,profileFile);
  assert.deepEqual(edited.image,{kind:'avatar',shape:'capsule',color:'sage'});
  const {image,...oldClient}=edited;
  await writeFile(profileFile,JSON.stringify({...oldClient,name:'Renamed by old CLI'}));
  assert.deepEqual((await cli('edit',origin,credential,agent.id,profileFile)).image,image);
  assert.deepEqual((await ctx.call(`/api/bots/${agent.id}`)).body.image,image);
}));

test('new upload references require stored bytes while unchanged missing images remain editable',()=>fixture(async(ctx)=>{
  const missing={kind:'upload',assetId:'a'.repeat(64)};
  assert.equal((await ctx.call('/api/bots',{name:'Missing',provider:'live',model:'fixture-offline',image:missing})).status,400);
  assert.equal((await ctx.call('/api/bots')).body.length,0);
  const crop=new PNG({width:256,height:256});crop.data.fill(90);
  const created=(await ctx.call('/api/bots',{name:'Stored',provider:'live',model:'fixture-offline',image:{kind:'upload-data',png:PNG.sync.write(crop).toString('base64')}},ctx.token,agentImageBodyType)).body;
  assert.equal((await ctx.call(`/api/bots/${created.id}/profile`,{...created,image:missing})).status,400);
  assert.deepEqual((await ctx.call(`/api/bots/${created.id}`)).body.image,created.image);
  const request={name:'Reuse',provider:'live',model:'fixture-offline',operationId:'reuse-upload',image:created.image};
  const reused=await ctx.call('/api/bots',request);assert.equal(reused.status,201);
  await rm(join(ctx.dir,'agents','.images',created.image.assetId+'.png'));
  assert.equal((await ctx.call('/api/bots',request)).body.id,reused.body.id,'accepted creation retry survives unavailable bytes');
  const renamed=await ctx.call(`/api/bots/${created.id}/profile`,{...created,name:'Keep missing image'});
  assert.equal(renamed.status,200);assert.deepEqual(renamed.body.image,created.image);
  const {image,...legacy}=renamed.body;
  assert.equal((await ctx.call(`/api/bots/${created.id}/profile`,{...legacy,instructions:'Still editable'})).status,200);
  assert.equal((await ctx.call('/api/bots',{name:'New missing reference',provider:'live',model:'fixture-offline',image})).status,400);
}));

test('bad crops and stale image saves do not change the current image or weaken other body limits',()=>fixture(async(ctx)=>{
  const agent=(await ctx.call('/api/bots',{name:'Safe',instructions:'',provider:'live',model:'fixture-offline'})).body;
  const image=new PNG({width:256,height:256});image.data.fill(128);const bytes=PNG.sync.write(image);
  const valid={kind:'upload-data',png:bytes.toString('base64')};
  assert.equal((await ctx.call(`/api/bots/${agent.id}/profile`,{...agent,image:valid})).status,415);
  const huge=Buffer.from(bytes);huge.writeUInt32BE(0x7fffffff,16);
  for(const png of [Buffer.from('not a png').toString('base64'),huge.toString('base64'),bytes.subarray(0,40).toString('base64'),Buffer.alloc(513*1024).toString('base64')]) {
    assert.equal((await ctx.call(`/api/bots/${agent.id}/profile`,{...agent,image:{kind:'upload-data',png}},ctx.token,agentImageBodyType)).status,400);
    assert.deepEqual((await ctx.call(`/api/bots/${agent.id}`)).body.image,{kind:'initials'});
  }
  const updated=(await ctx.call(`/api/bots/${agent.id}/profile`,{...agent,image:{kind:'avatar',shape:'hexagon',color:'rose'}})).body;
  assert.equal((await ctx.call(`/api/bots/${agent.id}/profile`,{...agent,image:valid},ctx.token,agentImageBodyType)).status,409);
  assert.deepEqual((await ctx.call(`/api/bots/${agent.id}`)).body.image,updated.image);
  assert.equal((await ctx.call('/api/commands',{content:'x'.repeat(70000)})).status,413);
  assert.equal((await ctx.call('/api/commands',{image:valid},ctx.token,agentImageBodyType)).status,415);
}));

test('production avatars retain the approved palette, circular eyes and symmetric rounded polygon geometry',()=>{
  assert.deepEqual(Object.values(agentImageColors).map(color=>color.hex),['#EFAB78','#EB8D88','#E6C368','#A8C79B','#7CC6BD','#8BB8DE','#B4A0D6','#D9A0BC']);
  for(const shape of Object.keys(agentImageShapes)) {
    const svg=avatarSvg({kind:'avatar',shape,color:'apricot'});
    const eyes=svg.match(/<g fill="#000">(.+?)<\/g>/)[1];
    assert.equal((eyes.match(/<circle /g)??[]).length,2);assert.doesNotMatch(svg,/<ellipse/);
    const sides={triangle:3,pentagon:5,hexagon:6}[shape];if(!sides)continue;
    const corners=[...svg.matchAll(/[ML] ([\d.,-]+) Q ([\d.,-]+) ([\d.,-]+)/g)].map(([,entry,vertex,exit])=>[entry,vertex,exit].map(point=>point.split(',').map(Number)));
    assert.equal(corners.length,sides,shape+' has a curved segment at each corner');
    for(const [entry,vertex,exit] of corners) {
      assert.ok(Math.hypot(entry[0]-vertex[0],entry[1]-vertex[1])>5,shape+' rounds before the vertex');
      assert.ok(Math.hypot(exit[0]-vertex[0],exit[1]-vertex[1])>5,shape+' rounds after the vertex');
    }
    const straightEdges=corners.map(([, ,exit],i)=>Math.hypot(exit[0]-corners[(i+1)%sides][0][0],exit[1]-corners[(i+1)%sides][0][1]));
    assert.ok(Math.min(...straightEdges)>0,shape+' retains straight edges');
    assert.ok(Math.max(...straightEdges)-Math.min(...straightEdges)<.000002,shape+' retains equal straight edges');
    const endpoints=corners.flatMap(([entry,,exit])=>[entry,exit]);
    assert.ok(endpoints.every(([x,y])=>endpoints.some(([mx,my])=>Math.hypot(mx-(64-x),my-y)<.000002)),shape+' rounds symmetrically');
    const points=corners.map(([,vertex])=>vertex);
    const lengths=points.map(([x,y],i)=>Math.hypot(x-points[(i+1)%points.length][0],y-points[(i+1)%points.length][1]));
    assert.ok(Math.max(...lengths)-Math.min(...lengths)<.000002);
    assert.ok(points.every(([x,y])=>points.some(([mx,my])=>Math.hypot(mx-(64-x),my-y)<.000002)));
    const angles=points.map(([x,y],i)=>{const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];return Math.acos(((a[0]-x)*(b[0]-x)+(a[1]-y)*(b[1]-y))/(Math.hypot(a[0]-x,a[1]-y)*Math.hypot(b[0]-x,b[1]-y)));});
    assert.ok(Math.max(...angles)-Math.min(...angles)<.000001);
  }
});

test('image is part of retry-safe creation identity and invalid choices never replace a saved image',()=>fixture(async({call})=>{
  const input={operationId:'image-create',name:'Scout',instructions:'',provider:'live',model:'fixture-offline',image:{kind:'avatar',shape:'triangle',color:'lagoon'}};
  const first=await call('/api/bots',input);assert.equal(first.status,201);assert.deepEqual(first.body.image,input.image);
  const again=await call('/api/bots',input);assert.equal(again.body.id,first.body.id);
  assert.equal((await call('/api/bots',{...input,image:{kind:'avatar',shape:'circle',color:'lagoon'}})).status,409);
  for(const image of [{kind:'avatar',shape:'ring',color:'sky'},{kind:'avatar',shape:'circle',color:'bad'},{kind:'upload',assetId:'../private'}, {kind:'initials',png:'unexpected'}]) {
    assert.equal((await call(`/api/bots/${first.body.id}/profile`,{...first.body,image})).status,400);
    assert.deepEqual((await call(`/api/bots/${first.body.id}`)).body.image,input.image);
  }
}));
