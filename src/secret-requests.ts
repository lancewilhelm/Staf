import {constants, closeSync, lstatSync, mkdirSync, openSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import type {WorkRef} from './action-journal.js';
import {containsUnsafeWebUrl} from './web-reader.js';
import {randomUUID} from 'node:crypto';

export const secretRequestInput=z.strictObject({name:z.string().trim().min(1).max(120),purpose:z.string().trim().min(1).max(500),destination:z.string().trim().min(1).max(300).optional()}).refine(input=>Object.values(input).every(value=>!containsUnsafeWebUrl(value)));
type Input=z.infer<typeof secretRequestInput>;
type Outcome='saved'|'skipped'|'dismissed';
const valueSchema=z.string().min(1).max(16000).refine(value=>!value.includes('\0'));

/** Separate store: ordinary instance records never contain the submitted value. */
export class SecretRequests {
 private db?:DatabaseSync;
 private readonly waiters=new Map<string,(outcome:Outcome|'interrupted')=>void>();
 constructor(private readonly root:string,private readonly memory:boolean) {
  if(!memory)try{lstatSync(join(root,'secrets','credentials.sqlite'));this.open(false);}catch(error){if(!(error instanceof Error && 'code' in error && error.code==='ENOENT'))throw Error('Secret store unavailable');}
 }
 private open(create:boolean):DatabaseSync {
  if(this.db)return this.db;
  let path=':memory:';
  if(!this.memory) {
   const directory=join(this.root,'secrets');
   if(create)mkdirSync(directory,{mode:0o700,recursive:true});
   const dir=lstatSync(directory);if(!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077)!==0)throw Error('Secret store unavailable');
   path=join(directory,'credentials.sqlite');
   if(create)try{const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);closeSync(fd);}catch(error){if(!(error instanceof Error && 'code' in error && error.code==='EEXIST'))throw Error('Secret store unavailable');}
   const stat=lstatSync(path);if(!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)!==0 || stat.nlink!==1)throw Error('Secret store unavailable');
  }
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON;
   CREATE TABLE IF NOT EXISTS secret_requests(id TEXT PRIMARY KEY,bot_id TEXT NOT NULL,work_kind TEXT NOT NULL,work_id TEXT NOT NULL,name TEXT NOT NULL,purpose TEXT NOT NULL,destination TEXT,state TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS secrets(name TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS secret_metadata(name TEXT PRIMARY KEY,purpose TEXT,revision TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS secret_selections(request_id TEXT PRIMARY KEY,secret_name TEXT NOT NULL,secret_revision TEXT NOT NULL);
   UPDATE secret_requests SET state='interrupted' WHERE state='pending';`);
  for(const row of db.prepare('SELECT name FROM secrets WHERE name NOT IN (SELECT name FROM secret_metadata)').all())db.prepare("INSERT INTO secret_metadata VALUES (?,(SELECT purpose FROM secret_requests WHERE name=? AND state='saved' ORDER BY rowid DESC LIMIT 1),?)").run(String(row.name),String(row.name),randomUUID());
  this.db=db;return db;
 }
 values():string[] {return this.db ? this.db.prepare('SELECT value FROM secrets').all().map(row=>String(row.value)) : [];}
 names() {if(!this.db)return [];return this.db.prepare("SELECT s.name,m.purpose,m.revision,(SELECT r.destination FROM secret_requests r WHERE r.name=s.name AND r.state='saved' ORDER BY r.rowid DESC LIMIT 1) AS destination FROM secrets s JOIN secret_metadata m ON m.name=s.name ORDER BY s.name").all();}
 add(input:{name:string;purpose:string;value:string}):void {const db=this.open(true);db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO secrets VALUES (?,?)').run(input.name,valueSchema.parse(input.value));db.prepare('INSERT INTO secret_metadata VALUES (?,?,?)').run(input.name,input.purpose,randomUUID());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
 replace(input:{name:string;revision:string;value:string}):void {const db=this.open(true);db.exec('BEGIN IMMEDIATE');try{const changed=db.prepare('UPDATE secret_metadata SET revision=? WHERE name=? AND revision=?').run(randomUUID(),input.name,input.revision).changes;if(!changed)throw Error('Secret changed');db.prepare('UPDATE secrets SET value=? WHERE name=?').run(valueSchema.parse(input.value),input.name);db.prepare('DELETE FROM secret_selections WHERE secret_name=?').run(input.name);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
 delete(name:string,revision?:string):boolean {const db=this.db;if(!db)return false;db.exec('BEGIN IMMEDIATE');try{if(revision && !db.prepare('SELECT 1 FROM secret_metadata WHERE name=? AND revision=?').get(name,revision))throw Error('Secret changed');const changed=!!db.prepare('DELETE FROM secrets WHERE name=?').run(name).changes;db.prepare('DELETE FROM secret_metadata WHERE name=?').run(name);db.prepare('DELETE FROM secret_selections WHERE secret_name=?').run(name);db.exec('COMMIT');return changed;}catch(error){db.exec('ROLLBACK');throw error;}}
 select(id:string,name:string,revision:string):Outcome {const db=this.db;if(!db)throw Error('Secret request unavailable');db.exec('BEGIN IMMEDIATE');try{const row=db.prepare("SELECT state FROM secret_requests WHERE id=?").get(id),secret=db.prepare('SELECT revision FROM secret_metadata WHERE name=? AND revision=?').get(name,revision);if(row?.state!=='pending' || !secret)throw Error('Secret request unavailable');db.prepare('INSERT INTO secret_selections VALUES (?,?,?)').run(id,name,revision);db.prepare("UPDATE secret_requests SET state='saved' WHERE id=?").run(id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}this.waiters.get(id)?.('saved');return 'saved';}
 list() {if(!this.db)return [];return this.db.prepare("SELECT id,bot_id AS botId,work_kind AS workKind,work_id AS workId,name,purpose,destination,state FROM secret_requests WHERE state IN ('pending','interrupted') ORDER BY rowid").all().map(row=>({kind:'secret' as const,id:String(row.id),botId:String(row.botId),work:{kind:row.workKind==='task'?'task' as const:'command' as const,id:String(row.workId)},name:String(row.name),purpose:String(row.purpose),destination:row.destination===null?null:String(row.destination),state:String(row.state)}));}
 create(id:string,botId:string,work:WorkRef,input:Input):void {this.open(true).prepare("INSERT INTO secret_requests VALUES (?,?,?,?,?,?,?,'pending')").run(id,botId,work.kind,work.id,input.name,input.purpose,input.destination??null);}
 wait(id:string,signal:AbortSignal):Promise<Outcome> {return new Promise((resolve,reject)=>{
  const finish=(outcome:Outcome|'interrupted')=>{signal.removeEventListener('abort',abort);this.waiters.delete(id);if(outcome==='interrupted')reject(Error('Secret request interrupted'));else resolve(outcome);};
  const abort=()=>{this.db?.prepare("UPDATE secret_requests SET state='interrupted' WHERE id=? AND state='pending'").run(id);finish('interrupted');};
  this.waiters.set(id,finish);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 });}
 decide(id:string,decision:Outcome,value?:unknown):Outcome {
  const db=this.db;if(!db)throw Error('Secret request unavailable');
  db.exec('BEGIN IMMEDIATE');
  try {const row=db.prepare("SELECT name,state FROM secret_requests WHERE id=?").get(id);if(!row || (row.state!=='pending' && !(row.state==='interrupted' && decision==='dismissed')))throw Error('Secret request unavailable');
   if(decision==='saved'){const secret=valueSchema.safeParse(value);if(!secret.success)throw Error('Invalid secret');if(db.prepare('SELECT 1 FROM secrets WHERE name=?').get(String(row.name)))throw Error('A secret with this name already exists');db.prepare('INSERT INTO secrets VALUES (?,?)').run(String(row.name),secret.data);db.prepare("INSERT INTO secret_metadata VALUES (?,(SELECT purpose FROM secret_requests WHERE id=?),?)").run(String(row.name),id,randomUUID());}
   db.prepare('UPDATE secret_requests SET state=? WHERE id=?').run(decision,id);db.exec('COMMIT');
  } catch(error){db.exec('ROLLBACK');throw error;}
  this.waiters.get(id)?.(decision);return decision;
 }
 close():void {this.db?.close();this.db=undefined;}
}
