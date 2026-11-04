import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const artifactSchema = `
CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), name TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('text','markdown','csv')), source_session_id TEXT, source_message_id TEXT, created_at TEXT NOT NULL, CHECK((source_session_id IS NULL) = (source_message_id IS NULL)));
CREATE TABLE IF NOT EXISTS artifact_revisions (artifact_id TEXT NOT NULL REFERENCES artifacts(id), revision INTEGER NOT NULL, content BLOB NOT NULL, digest TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(artifact_id,revision));
CREATE TABLE IF NOT EXISTS artifact_operations (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), fingerprint TEXT NOT NULL, artifact_id TEXT NOT NULL, revision INTEGER NOT NULL, FOREIGN KEY(artifact_id,revision) REFERENCES artifact_revisions(artifact_id,revision));`;
export type ArtifactFormat = 'text' | 'markdown' | 'csv';
export type ArtifactSource = {sessionId:string; messageId:string};
export type ArtifactCreate = {operationId:string; name:string; format:ArtifactFormat; content:string; source?:ArtifactSource};
export type ArtifactRevise = {operationId:string; expectedRevision:number; content:string};
export class ArtifactConflict extends Error {}
const hash = (value:string) => createHash('sha256').update(value,'utf8').digest('hex');
function contentValid(content:string) { return Buffer.byteLength(content,'utf8') <= 1048576 && Buffer.from(content,'utf8').toString('utf8')===content; }
function operationValid(id:string) { return /^[\w-]{1,100}$/.test(id); }
export function parseArtifactCreate(value:unknown):ArtifactCreate {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw Error('Invalid artifact');
  const v = value as Record<string,unknown>;
  if (typeof v.operationId!=='string' || !operationValid(v.operationId) || typeof v.name!=='string' || !v.name.trim() || v.name.includes('\0') || Buffer.byteLength(v.name,'utf8')>200 || Buffer.from(v.name,'utf8').toString('utf8')!==v.name || typeof v.content!=='string' || !contentValid(v.content) || (v.format!=='text' && v.format!=='markdown' && v.format!=='csv')) throw Error('Invalid artifact name, format, content, or operation');
  let source:ArtifactSource|undefined;
  if (v.source!==undefined) {
    if (!v.source || typeof v.source!=='object' || Array.isArray(v.source) || !('sessionId' in v.source) || !('messageId' in v.source) || typeof v.source.sessionId!=='string' || typeof v.source.messageId!=='string' || !operationValid(v.source.sessionId) || !operationValid(v.source.messageId)) throw Error('Invalid artifact source');
    source={sessionId:v.source.sessionId,messageId:v.source.messageId};
  }
  return {operationId:v.operationId,name:v.name,format:v.format,content:v.content,...(source ? {source} : {})};
}
export function parseArtifactRevise(value:unknown):ArtifactRevise {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw Error('Invalid revision');
  const v=value as Record<string,unknown>;
  if (typeof v.operationId!=='string' || !operationValid(v.operationId) || typeof v.expectedRevision!=='number' || !Number.isSafeInteger(v.expectedRevision) || v.expectedRevision<1 || typeof v.content!=='string' || !contentValid(v.content)) throw Error('Invalid revision content or operation');
  return {operationId:v.operationId,expectedRevision:v.expectedRevision,content:v.content};
}
export class ArtifactStore {
  constructor(private db:DatabaseSync, private validateSource:(botId:string,source:ArtifactSource)=>boolean) {}
  list(botId:string) {return this.db.prepare(`SELECT a.id,a.name,a.format,a.created_at AS createdAt,a.source_session_id AS sourceSessionId,a.source_message_id AS sourceMessageId,MAX(r.revision) AS revision,MAX(r.created_at) AS updatedAt FROM artifacts a JOIN artifact_revisions r ON r.artifact_id=a.id WHERE a.bot_id=? GROUP BY a.id ORDER BY updatedAt DESC,a.id`).all(botId);}
  revisions(botId:string,id:string) {if (!this.exists(botId,id)) throw Error('Artifact not found');return this.db.prepare('SELECT revision,digest,created_at AS createdAt FROM artifact_revisions WHERE artifact_id=? ORDER BY revision DESC').all(id);}
  read(botId:string,id:string,revision:number) {const row=this.db.prepare(`SELECT a.id,a.name,a.format,a.created_at AS artifactCreatedAt,a.source_session_id AS sourceSessionId,a.source_message_id AS sourceMessageId,r.revision,r.content,r.digest,r.created_at AS createdAt FROM artifacts a JOIN artifact_revisions r ON r.artifact_id=a.id WHERE a.bot_id=? AND a.id=? AND r.revision=?`).get(botId,id,revision);if(!row)throw Error('Artifact revision not found');if(!(row.content instanceof Uint8Array) || (row.format!=='text' && row.format!=='markdown' && row.format!=='csv'))throw Error('Invalid stored artifact content');return {id:String(row.id),name:String(row.name),format:row.format,artifactCreatedAt:String(row.artifactCreatedAt),sourceSessionId:typeof row.sourceSessionId==='string' ? row.sourceSessionId : null,sourceMessageId:typeof row.sourceMessageId==='string' ? row.sourceMessageId : null,revision:Number(row.revision),content:Buffer.from(row.content).toString('utf8'),digest:String(row.digest),createdAt:String(row.createdAt)};}
  private exists(botId:string,id:string) {return !!this.db.prepare('SELECT 1 FROM artifacts WHERE bot_id=? AND id=?').get(botId,id);}
  private retry(botId:string,operationId:string,fingerprint:string) {const row=this.db.prepare('SELECT bot_id,fingerprint,artifact_id,revision FROM artifact_operations WHERE id=?').get(operationId);if(!row)return undefined;if(row.bot_id!==botId || row.fingerprint!==fingerprint)throw new ArtifactConflict('Operation ID already used with different input');return this.read(botId,String(row.artifact_id),Number(row.revision));}
  create(botId:string,raw:ArtifactCreate) {const input=parseArtifactCreate(raw), fingerprint=hash(JSON.stringify(['create',botId,input.name,input.format,input.content,input.source ?? null]));
    this.db.exec('BEGIN IMMEDIATE');try {const prior=this.retry(botId,input.operationId,fingerprint);if(prior){this.db.exec('COMMIT');return prior;}if(input.source && !this.validateSource(botId,input.source))throw Error('Source message not found for this agent and session');const id=randomUUID(),now=new Date().toISOString();this.db.prepare('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?)').run(id,botId,input.name,input.format,input.source?.sessionId ?? null,input.source?.messageId ?? null,now);this.db.prepare('INSERT INTO artifact_revisions VALUES (?,?,?,?,?)').run(id,1,Buffer.from(input.content,'utf8'),hash(input.content),now);this.db.prepare('INSERT INTO artifact_operations VALUES (?,?,?,?,?)').run(input.operationId,botId,fingerprint,id,1);const result=this.read(botId,id,1);this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  revise(botId:string,id:string,raw:ArtifactRevise) {const input=parseArtifactRevise(raw),fingerprint=hash(JSON.stringify(['revise',botId,id,input.expectedRevision,input.content]));this.db.exec('BEGIN IMMEDIATE');try{const prior=this.retry(botId,input.operationId,fingerprint);if(prior){this.db.exec('COMMIT');return prior;}if(!this.exists(botId,id))throw Error('Artifact not found');const row=this.db.prepare('SELECT MAX(revision) AS revision FROM artifact_revisions WHERE artifact_id=?').get(id);if(row?.revision!==input.expectedRevision)throw new ArtifactConflict('Artifact has changed; your draft was not saved');const revision=input.expectedRevision+1,now=new Date().toISOString();this.db.prepare('INSERT INTO artifact_revisions VALUES (?,?,?,?,?)').run(id,revision,Buffer.from(input.content,'utf8'),hash(input.content),now);this.db.prepare('INSERT INTO artifact_operations VALUES (?,?,?,?,?)').run(input.operationId,botId,fingerprint,id,revision);const result=this.read(botId,id,revision);this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
