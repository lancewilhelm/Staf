import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startInstance } from '../dist/instance-service.js';
import { Instance } from '../dist/instance.js';
import { DatabaseSync } from 'node:sqlite';

function pdf(text='A real document passage', pageCount=1) {
 const stream=`BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
 const kids=Array.from({length:pageCount},(_,i)=>`${i+3} 0 R`);const content=pageCount+3,font=pageCount+4;const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`,...kids.map(()=>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`),`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let result='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(result));result+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(result);result+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(result);
}
test('document service persists exact originals, excerpts, scope and retries',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-docs-'));let app=startInstance(join(dir,'db'),0,{env:{}}),port=await app.listen();
 const call=async(path,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()]};
 try{
  const a=(await call('/api/pair',null,{code:app.code}))[1].token,b=(await call('/api/pair',null,{code:app.issueCode()}))[1].token;
  const bot=(await call('/api/bots',a,{name:'Ada'}))[1],other=(await call('/api/bots',a,{name:'Other'}))[1];const root=`/api/bots/${bot.id}/documents`,otherRoot=`/api/bots/${other.id}/documents`;
  const original=pdf(),input={operationId:'pdf-one',name:'source.pdf',base64:original.toString('base64')};
  const [status,doc]=await call(root,a,input);assert.equal(status,201);assert.equal((await call(root,a,input))[1].id,doc.id);assert.equal((await call(root,a,{...input,name:'different.pdf'}))[0],400);
  const found=(await call(root+'/search',a,{query:'document passage'}))[1];assert.equal(found.length,1);assert.equal(found[0].page,1);assert.match(found[0].text,/real document passage/);assert.equal(found[0].digest,doc.digest);
  assert.equal((await call(otherRoot+'/'+doc.id,b))[0],400);assert.deepEqual((await call(otherRoot+'/search',b,{query:'passage'}))[1],[]);
  const download=await fetch(`http://127.0.0.1:${port}${root}/${doc.id}/original`,{headers:{Authorization:`Bearer ${b}`}});assert.deepEqual(Buffer.from(await download.arrayBuffer()),original);
  const text=Buffer.from('First line\nSecond exact line');const doc2=(await call(root,a,{operationId:'text-one',name:'notes.md',base64:text.toString('base64')}))[1];assert.equal((await call(root+'/'+doc2.id,a))[1].excerpts[0].line,1);
  for(const [name,bytes] of [['wrong.pdf',Buffer.from('text')],['bad.txt',Buffer.from([255])],['empty.txt',Buffer.from('  ')],['bad.pdf',Buffer.from('%PDF-not a pdf')]])assert.equal((await call(root,a,{operationId:name,name,base64:bytes.toString('base64')}))[0],400);
  const long=(await call(root,a,{operationId:'long',name:'long.txt',base64:Buffer.from('a'.repeat(51000)).toString('base64')}))[1];assert.equal((await call(root+'/'+long.id,a))[1].excerpts.length,50);const next=(await call(root+'/'+long.id+'/excerpts/50',a))[1];assert.equal(next.excerpts.length,1);assert.equal(next.excerpts[0].excerptId,'51');
  const listed=(await call(root,a))[1];assert.deepEqual((await call(root+'/pages/1',a))[1],listed.slice(1));
  const clients=(await call('/api/clients',a))[1];const bId=clients.find(c=>!c.current).id;await call('/api/clients/'+bId+'/revoke',a,{});assert.equal((await call(root,b))[0],401);
  await app.close();app=startInstance(join(dir,'db'),0,{env:{}});port=await app.listen();assert.equal((await call(root+'/'+doc.id,a))[1].document.digest,doc.digest);assert.equal((await call(root,a,input))[1].id,doc.id);
  await call(root+'/'+doc.id+'/retire',a,{});assert.deepEqual((await call(root+'/search',a,{query:'document passage'}))[1],[]);assert.equal((await call(root+'/'+doc.id,a))[1].excerpts[0].excerptId,found[0].excerptId);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('asynchronous PDF import checks authority again and cancellation leaves no source',async()=>{
 const instance=new Instance(':memory:');try{const bot=instance.createBot({name:'A',instructions:'',provider:'demo'});const signal=new AbortController();let checks=0;await assert.rejects(instance.documentImport({botId:bot.id,operationId:'revoke',name:'a.pdf',bytes:pdf()},signal.signal,()=>{if(++checks===2)throw Error('revoked')}),/revoked/);assert.equal(instance.documents(bot.id).length,0);
 await assert.rejects(instance.documentImport({botId:bot.id,operationId:'encrypted',name:'a.pdf',bytes:readFileSync(new URL('./fixtures/encrypted.pdf',import.meta.url))},new AbortController().signal,()=>{}),/Encrypted PDFs/);
 await assert.rejects(instance.documentImport({botId:bot.id,operationId:'empty-pdf',name:'a.pdf',bytes:pdf('')},new AbortController().signal,()=>{}),/no readable text/i);
 await assert.rejects(instance.documentImport({botId:bot.id,operationId:'too-many-pages',name:'a.pdf',bytes:pdf('text',201)},new AbortController().signal,()=>{}),/200 pages/);
 await assert.rejects(instance.documentImport({botId:bot.id,operationId:'too-much-text',name:'a.txt',bytes:Buffer.from('x'.repeat(1000001))},new AbortController().signal,()=>{}),/1000000/);
 await assert.rejects(instance.documentImport({botId:bot.id,operationId:'too-large',name:'a.txt',bytes:Buffer.alloc(10*1024*1024+1,65)},new AbortController().signal,()=>{}),/10 MiB/);
 const mutable=pdf(),original=Buffer.from(mutable);const publication=instance.documentImport({botId:bot.id,operationId:'snapshot',name:'snapshot.pdf',bytes:mutable},new AbortController().signal,()=>{});mutable.fill(0);const snapshot=await publication;assert.deepEqual(Buffer.from(instance.documentOriginal(bot.id,snapshot.id).bytes),original);
 const cancel=new AbortController();const survivor=instance.documentImport({botId:bot.id,operationId:'survivor',name:'b.pdf',bytes:pdf()},new AbortController().signal,()=>{});const pending=instance.documentImport({botId:bot.id,operationId:'cancel',name:'a.pdf',bytes:pdf()},cancel.signal,()=>{});cancel.abort();await assert.rejects(pending,/cancel/i);assert.equal((await survivor).name,'b.pdf');assert.equal(instance.documents(bot.id).length,2);
 }finally{instance.close();}
});

test('version 30 upgrades document tables after a protected backup', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-doc-upgrade-')),path=join(dir,'db');let instance=new Instance(path);
 try {const bot=instance.createBot({name:'Existing',instructions:'Keep',provider:'demo'});instance.close();const legacy=new DatabaseSync(path);legacy.exec('DROP TABLE document_excerpts; DROP TABLE document_sources; PRAGMA user_version=30');legacy.close();
 instance=new Instance(path);assert.ok(instance.migrationBackup);const backup=new DatabaseSync(instance.migrationBackup,{readOnly:true});assert.equal(backup.prepare('PRAGMA user_version').get().user_version,30);backup.close();assert.equal(instance.bot(bot.id).name,'Existing');const saved=await instance.documentImport({botId:bot.id,operationId:'post-upgrade',name:'a.txt',bytes:Buffer.from('retained')},new AbortController().signal,()=>{});assert.equal(instance.documentRead(bot.id,saved.id).excerpts[0].text,'retained');
 }finally{instance.close();rmSync(dir,{recursive:true,force:true});}
});
