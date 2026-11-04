import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import type { DocumentSummary, DocumentExcerpt } from './document-types.js';

export const documentSchema = `CREATE TABLE IF NOT EXISTS document_sources (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), operation_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, name TEXT NOT NULL, media_type TEXT NOT NULL, digest TEXT NOT NULL, original BLOB NOT NULL, retired INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS document_excerpts (document_id TEXT NOT NULL REFERENCES document_sources(id), id TEXT NOT NULL, position INTEGER NOT NULL, page INTEGER, line INTEGER, text TEXT NOT NULL, PRIMARY KEY(document_id,id)); CREATE INDEX IF NOT EXISTS document_sources_bot ON document_sources(bot_id, retired);`;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export type DocumentImport = {botId:string; operationId:string; name:string; bytes:Uint8Array};
type Passage = {page:number|null; line:number|null; text:string};
let running = 0;
function pdfPages(bytes:Uint8Array, signal:AbortSignal):Promise<string[]> {
  signal.throwIfAborted();
  if (running >= 4) throw Error('Too many document extractions; try again');
  running++;
  return new Promise((resolve,reject)=>{
    let settled=false;
    let worker:Worker;
    try {worker = new Worker(new URL('./document-extraction-worker.js',import.meta.url), {workerData:bytes, resourceLimits:{maxOldGenerationSizeMb:128, maxYoungGenerationSizeMb:16, stackSizeMb:4}});} catch(error) {running--; reject(error);return;}
    const timer=setTimeout(()=>finish(Error('PDF extraction timed out')),15000);
    const abort=()=>finish(Error('Document extraction cancelled'));
    function finish(error?:Error,pages?:string[]) { if(settled)return; settled=true; clearTimeout(timer); signal.removeEventListener('abort',abort); void worker.terminate().then(()=>{running--;},()=>{running--;}); if(error)reject(error); else resolve(pages ?? []); }
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();
    worker.once('message',(message:unknown)=>{if(typeof message==='object' && message!==null && 'pages' in message && Array.isArray(message.pages) && message.pages.every(item=>typeof item==='string')) finish(undefined,message.pages); else if(typeof message==='object' && message!==null && 'error' in message && typeof message.error==='string') finish(Error(message.error)); else finish(Error('PDF extraction failed'));});
    worker.once('error',()=>finish(Error('PDF extraction failed or exceeded memory limit')));
    worker.once('exit',()=>finish(Error('PDF extraction stopped')));
  });
}
function segments(text:string,page:number|null):Passage[] {
  const result:Passage[]=[]; let line=1;
  for(let start=0;start<text.length;){let end=Math.min(start+1000,text.length);if(end<text.length && /[\uD800-\uDBFF]/.test(text[end-1] ?? ''))end--;const part=text.slice(start,end); if(part.trim())result.push({page,line:page===null?line:null,text:part}); line+=(part.match(/\n/g) ?? []).length;start=end;}
  return result;
}
function format(name:string,bytes:Uint8Array) {
  if(!name || name.length>255 || /[\x00-\x1f/\\]/.test(name))throw Error('Invalid document filename');
  const extension=name.toLowerCase().match(/\.(txt|md|csv|pdf)$/)?.[1];
  if(!extension)throw Error('Supported formats are .txt, .md, .csv, and .pdf');
  const pdf=Buffer.from(bytes.subarray(0,5)).toString('ascii')==='%PDF-';
  if((extension==='pdf')!==pdf)throw Error('File type does not match its extension');
  return extension==='pdf'?'application/pdf':extension==='csv'?'text/csv':extension==='md'?'text/markdown':'text/plain';
}
function summary(row:Record<string,unknown>):DocumentSummary {
  return {id:String(row.id),name:String(row.name),mediaType:String(row.media_type),digest:String(row.digest),retired:row.retired===1,createdAt:String(row.created_at)};
}
export class DocumentStore {
  constructor(private db:DatabaseSync) {}
  list(botId:string,offset=0,activeOnly=false):DocumentSummary[] {if(!Number.isSafeInteger(offset) || offset<0 || offset>1000000)throw Error('Invalid document offset');return this.db.prepare(`SELECT id,name,media_type,digest,retired,created_at FROM document_sources WHERE bot_id=? ${activeOnly?'AND retired=0':''} ORDER BY rowid DESC LIMIT 500 OFFSET ?`).all(botId,offset).map(summary);}
  async import(input:DocumentImport, signal:AbortSignal, authorize:()=>void):Promise<DocumentSummary> {
    if(!/^[\w-]{1,100}$/.test(input.operationId))throw Error('Invalid operation ID');
    if(!input.bytes.length || input.bytes.length>DOCUMENT_MAX_BYTES)throw Error('Document must be between 1 byte and 10 MiB');
    const bytes=Uint8Array.from(input.bytes);
    const mediaType=format(input.name,bytes),digest=createHash('sha256').update(bytes).digest('hex');
    const fingerprint=createHash('sha256').update(JSON.stringify([input.botId,input.name,digest])).digest('hex');
    const previous=()=>this.db.prepare('SELECT * FROM document_sources WHERE operation_id=?').get(input.operationId);
    const retry=()=>{const row=previous();if(row && row.fingerprint!==fingerprint)throw Error('Document operation ID conflict');return row?summary(row):undefined;};
    signal.throwIfAborted(); authorize(); const old=retry(); if(old)return old;
    let passages:Passage[];
    if(mediaType==='application/pdf') passages=(await pdfPages(bytes,signal)).flatMap((text,index)=>segments(text,index+1));
    else {let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('Document must be valid UTF-8');} if(text.includes('\0'))throw Error('Document contains invalid text');if(text.length>1_000_000)throw Error('Extracted text exceeds 1000000 characters');if(!text.trim())throw Error('Document has no readable text');passages=segments(text,null);}
    signal.throwIfAborted(); authorize(); const again=retry();if(again)return again;
    const id=randomUUID(); this.db.exec('BEGIN IMMEDIATE');
    try {this.db.prepare('INSERT INTO document_sources VALUES (?,?,?,?,?,?,?,?,0,?)').run(id,input.botId,input.operationId,fingerprint,input.name,mediaType,digest,bytes,new Date().toISOString());const insert=this.db.prepare('INSERT INTO document_excerpts VALUES (?,?,?,?,?,?)');passages.forEach((passage,index)=>insert.run(id,String(index+1),index,passage.page,passage.line,passage.text));this.db.exec('COMMIT');}
    catch(error){this.db.exec('ROLLBACK');throw error;}
    const row=this.db.prepare('SELECT * FROM document_sources WHERE id=?').get(id);if(!row)throw Error('Document unavailable');return summary(row);
  }
  read(botId:string,id:string) {const row=this.db.prepare('SELECT * FROM document_sources WHERE bot_id=? AND id=?').get(botId,id);if(!row)throw Error('Document not found');return summary(row);}
  original(botId:string,id:string) {const row=this.db.prepare('SELECT * FROM document_sources WHERE bot_id=? AND id=?').get(botId,id);if(!row || !(row.original instanceof Uint8Array))throw Error('Document not found');return {document:summary(row),bytes:row.original};}
  retire(botId:string,id:string) {const result=this.db.prepare('UPDATE document_sources SET retired=1 WHERE bot_id=? AND id=?').run(botId,id);if(!result.changes)throw Error('Document not found');return this.read(botId,id);}
  excerpts(botId:string,id:string,offset=0):DocumentExcerpt[] {if(!Number.isSafeInteger(offset) || offset<0 || offset>1000000)throw Error('Invalid passage offset');return this.query(botId,' AND d.id=? AND e.position>=?',[id,offset]);}
  search(botId:string,query:string):DocumentExcerpt[] {if(!query.trim() || query.length>200)throw Error('Search must contain 1 to 200 characters');return this.query(botId,' AND d.retired=0 AND instr(lower(e.text),lower(?))>0',[query]);}
  resolve(botId:string,id:string,excerptId:string):DocumentExcerpt {const result=this.query(botId,' AND d.id=? AND e.id=?',[id,excerptId])[0];if(!result)throw Error('Excerpt not found');return result;}
  private query(botId:string,where:string,args:(string|number)[]):DocumentExcerpt[] {return this.db.prepare(`SELECT d.id,d.name,d.digest,e.id AS excerpt_id,e.page,e.line,e.text FROM document_sources d JOIN document_excerpts e ON e.document_id=d.id WHERE d.bot_id=? ${where} ORDER BY d.rowid DESC,e.position LIMIT 50`).all(botId,...args).map(row=>({documentId:String(row.id),excerptId:String(row.excerpt_id),name:String(row.name),digest:String(row.digest),page:typeof row.page==='number'?row.page:null,line:typeof row.line==='number'?row.line:null,text:String(row.text)}));}
}

/** The host supplies a check for the captured work and its authority on every call. */
export function documentCapabilities(store:DocumentStore,scope:{botId:string;signal:AbortSignal;check:()=>void}) {
  const check=()=>{scope.signal.throwIfAborted();scope.check();};
  return {list:(offset=0)=>{check();return store.list(scope.botId,offset,true);},search:(query:string)=>{check();return store.search(scope.botId,query);},resolve:(documentId:string,excerptId:string)=>{check();const doc=store.read(scope.botId,documentId);if(doc.retired)throw Error('Document retired');return store.resolve(scope.botId,documentId,excerptId);}};
}
