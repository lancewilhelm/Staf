import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';

test('workspace assets are served under a restrictive same-origin policy',async()=>{
 const app=startInstance(':memory:');const port=await app.listen();const base=`http://127.0.0.1:${port}`;
 try{const response=await fetch(base+'/');const html=await response.text();const csp=response.headers.get('content-security-policy');assert.match(csp,/script-src 'self'/);assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval/);const paths=[...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match=>match[1]);assert.equal(paths.length,2);for(const path of paths){const asset=await fetch(base+path);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),path.endsWith('.css')?/text\/css/:/javascript/)}assert.equal((await fetch(base+'/assets/missing.js')).status,404);const paired=await fetch(base+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:app.code})});const token=(await paired.json()).token;assert.equal((await fetch(base+'/advanced',{headers:{Authorization:'Bearer '+token}})).status,404);assert.equal((await fetch(base+'/advanced.js',{headers:{Authorization:'Bearer '+token}})).status,404)}finally{await app.close()}
});

test('bot creation operation is atomic, repeatable, and recoverable after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gui-'));let app=startInstance(join(dir,'db'));let port=await app.listen();let token='';
 const call=async(path,body)=>{const res=await fetch(`http://127.0.0.1:${port}`+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json()}};
 try{token=(await call('/api/pair',{code:app.code})).body.token;const initial=(await call('/api/creation-defaults')).body;await call('/api/creation-defaults',{...initial,reasoning:'high'});const defaults=(await call('/api/creation-defaults')).body;const input={operationId:'create-1',name:'Ada',instructions:'Explain',provider:'codex',model:'model-one'};assert.equal((await call('/api/bots',{...input,operationId:'invalid operation',instructions:' '})).status,400);const first=await call('/api/bots',input);assert.equal(first.status,201);assert.equal(first.body.provider,'codex');assert.equal(first.body.model,'model-one');assert.equal(first.body.reasoning,'high');assert.equal((await call('/api/bots',input)).body.id,first.body.id);assert.equal((await call('/api/bots',{...input,instructions:'Different'})).status,409);assert.equal((await call('/api/bots')).body.length,1);assert.deepEqual((await call('/api/creation-defaults')).body,defaults);await app.close();app=startInstance(join(dir,'db'));port=await app.listen();assert.equal((await call('/api/bot-creations/create-1')).body.id,first.body.id);assert.deepEqual((await call('/api/inbox')).body,[]);assert.deepEqual((await call('/api/task-updates')).body,[])}finally{await app.close();rmSync(dir,{recursive:true,force:true})}
});
