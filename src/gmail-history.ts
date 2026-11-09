import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';

export const gmailMonitorRunsSchema = `
CREATE TABLE IF NOT EXISTS gmail_monitor_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL,
  started_at INTEGER NOT NULL, finished_at INTEGER,
  outcome TEXT NOT NULL CHECK(outcome IN ('running','completed','failed','uncertain','interrupted'))
);
CREATE INDEX IF NOT EXISTS gmail_monitor_runs_account ON gmail_monitor_runs(account_id,id DESC);`;

export const gmailArrivalEvidenceSchema = `
CREATE TABLE IF NOT EXISTS gmail_arrival_evidence (
  account_id TEXT NOT NULL, message_id TEXT NOT NULL,
  inbox TEXT NOT NULL CHECK(inbox IN ('yes','no','unknown')),
  PRIMARY KEY(account_id,message_id)
);`;

// The cursor and all arrivals from a complete history scan are committed together.
export const gmailHistorySchema = `
CREATE TABLE IF NOT EXISTS gmail_history (account_id TEXT PRIMARY KEY, cursor TEXT NOT NULL, state TEXT NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS gmail_arrivals (account_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(account_id,message_id));
CREATE TABLE IF NOT EXISTS gmail_history_gaps (account_id TEXT NOT NULL, previous_cursor TEXT, new_cursor TEXT NOT NULL, reason TEXT NOT NULL, recorded_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS gmail_model_access (account_id TEXT NOT NULL, bot_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, PRIMARY KEY(account_id,bot_id));
CREATE TABLE IF NOT EXISTS gmail_private_commands (command_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS gmail_private_messages (message_id TEXT PRIMARY KEY);
${gmailMonitorRunsSchema}
${gmailArrivalEvidenceSchema}`;

const profileSchema=z.object({emailAddress:z.email(),historyId:z.string().regex(/^\d+$/)});
const pageSchema=z.object({historyId:z.string().regex(/^\d+$/),nextPageToken:z.string().min(1).optional(),messageIds:z.array(z.string().min(1).max(200)).max(10000),additions:z.array(z.object({messageId:z.string().min(1).max(200),historyId:z.string().regex(/^\d+$/).nullable()})).max(10000).optional()});
const metadataSchema=z.object({id:z.string(),historyId:z.string().regex(/^\d+$/).optional(),labelIds:z.array(z.string()).max(1000).optional()});
export interface GmailHistoryTransport {
  profile():Promise<unknown>;
  // Gmail does not prove historical inbox membership in its message-added record.
  history(input:{startHistoryId:string;pageToken?:string}):Promise<unknown>;
  messageMetadata?(messageId:string):Promise<unknown>;
}
export class GmailHistoryExpired extends Error {
  constructor(){super('Gmail history expired; the interval cannot be reconstructed');}
}

export class GmailHistory {
  constructor(private readonly db:DatabaseSync,private readonly transport?:GmailHistoryTransport,private readonly assertAuthority:()=>void=()=>{}) {}

  status(accountId:string) {
    const row=this.db.prepare('SELECT cursor,state,detail FROM gmail_history WHERE account_id=?').get(accountId);
    if(!row || typeof row.cursor!=='string' || typeof row.state!=='string' || !(row.detail===null || typeof row.detail==='string'))throw Error('Gmail baseline unavailable');
    return {cursor:row.cursor,state:row.state,detail:row.detail};
  }

  arrivals(accountId:string) {
    return this.page(accountId).arrivals.reverse();
  }

  page(accountId:string,before?:number) {
    if(before!==undefined && (!Number.isSafeInteger(before)||before<1))throw Error('Invalid Gmail arrival cursor');
    const rows=this.db.prepare("SELECT a.rowid AS seq,a.message_id AS messageId,COALESCE(e.inbox,'unknown') AS inbox FROM gmail_arrivals a LEFT JOIN gmail_arrival_evidence e ON e.account_id=a.account_id AND e.message_id=a.message_id WHERE a.account_id=? AND (? IS NULL OR a.rowid<?) ORDER BY a.rowid DESC LIMIT 101").all(accountId,before??null,before??null);
    const selected=rows.slice(0,100);
    return {arrivals:selected.map(row=>({messageId:String(row.messageId),inbox:z.enum(['yes','no','unknown']).parse(row.inbox)})),nextBefore:rows.length>100?Number(selected.at(-1)?.seq):null};
  }

  snapshot(accountId:string) {
    const exists=this.db.prepare('SELECT 1 FROM gmail_history WHERE account_id=?').get(accountId);
    const gaps=this.db.prepare('SELECT previous_cursor AS previousCursor,new_cursor AS newCursor,reason,recorded_at AS recordedAt FROM gmail_history_gaps WHERE account_id=? ORDER BY rowid DESC LIMIT 20').all(accountId);
    const runs=this.db.prepare('SELECT id,started_at AS startedAt,finished_at AS finishedAt,outcome FROM gmail_monitor_runs WHERE account_id=? ORDER BY id DESC LIMIT 30').all(accountId);
    return {monitor:exists?this.status(accountId):null,...this.page(accountId),gaps,runs};
  }

  rebaseline(accountId:string,cursor:string) {
    if(!/^\d+$/.test(cursor))throw Error('Invalid Gmail history ID');this.assertAuthority();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old=this.db.prepare('SELECT cursor FROM gmail_history WHERE account_id=?').get(accountId);
      this.db.prepare('INSERT INTO gmail_history_gaps VALUES (?,?,?,?,?)').run(accountId,typeof old?.cursor==='string'?old.cursor:null,cursor,old?'History expired or monitoring restarted':'Monitoring began after the account was connected',Date.now());
      this.db.prepare("INSERT INTO gmail_history VALUES (?,?,'ready',NULL) ON CONFLICT(account_id) DO UPDATE SET cursor=excluded.cursor,state='ready',detail=NULL").run(accountId,cursor);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  async connect(accountId:string) {
    if(!this.transport)throw Error('Gmail transport unavailable');
    this.assertAuthority();
    const profile=profileSchema.parse(await this.transport.profile());
    this.assertAuthority();
    if(profile.emailAddress.toLowerCase()!==accountId.toLowerCase())throw Error('Gmail account does not match the selected account');
    this.db.prepare("INSERT OR IGNORE INTO gmail_history VALUES (?,?,'ready',NULL)").run(accountId,profile.historyId);
    return this.status(accountId);
  }

  async poll(accountId:string) {
    if(!this.transport)throw Error('Gmail transport unavailable');
    const {cursor}=this.status(accountId),messages=new Set<string>(),additions=new Map<string,string>(),tokens=new Set<string>();
    this.assertAuthority();
    const runId=this.db.prepare("INSERT INTO gmail_monitor_runs (account_id,started_at,outcome) VALUES (?,?,'running')").run(accountId,Date.now()).lastInsertRowid;
    let pageToken:string|undefined,latest=cursor;
    try {
      for(let page=0;;page++) {
        if(page>=100)throw Error('Gmail history scan exceeds the page limit');
        this.assertAuthority();
        const result=pageSchema.parse(await this.transport.history({startHistoryId:cursor,...(pageToken?{pageToken}:{})}));
        latest=result.historyId;
        for(const id of result.messageIds)messages.add(id);
        for(const addition of result.additions??[]) {
          if(!messages.has(addition.messageId))throw Error('Unexpected Gmail addition evidence');
          const previous=additions.get(addition.messageId),current=addition.historyId??'';
          additions.set(addition.messageId,previous===undefined || previous===current?current:'');
        }
        if(messages.size>10000)throw Error('Gmail history scan exceeds the arrival limit');
        if(!result.nextPageToken)break;
        if(tokens.has(result.nextPageToken))throw Error('Gmail history pagination repeated');
        tokens.add(result.nextPageToken);pageToken=result.nextPageToken;
      }
      if(BigInt(latest)<BigInt(cursor))throw Error('Gmail history cursor moved backwards');
      const evidence=new Map<string,'yes'|'no'|'unknown'>();
      const existing=this.db.prepare('SELECT 1 FROM gmail_arrivals WHERE account_id=? AND message_id=?');
      const unseen=[...messages].filter(id=>!existing.get(accountId,id));
      let index=0;
      await Promise.all(Array.from({length:Math.min(8,unseen.length)},async()=>{
        while(index<unseen.length) {
          const id=unseen[index++]!,addition=additions.get(id);let state:'yes'|'no'|'unknown'='unknown';
          if(addition && this.transport?.messageMetadata) {
            try {
              this.assertAuthority();const metadata=metadataSchema.parse(await this.transport.messageMetadata(id));this.assertAuthority();
              // Matching IDs tie the current labels to the last message change;
              // Gmail does not guarantee a complete historical classification.
              if(metadata.id===id && metadata.historyId===addition && metadata.labelIds) {
                const labels=metadata.labelIds;
                state=labels.includes('INBOX') && !labels.some(label=>['SENT','DRAFT','SPAM','TRASH'].includes(label))?'yes':'no';
              }
            } catch {this.assertAuthority();}
          }
          evidence.set(id,state);
        }
      }));
      this.assertAuthority();
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const changed=this.db.prepare("UPDATE gmail_history SET cursor=?,state='ready',detail=NULL WHERE account_id=? AND cursor=?").run(latest,accountId,cursor);
        if(changed.changes!==1)throw Error('Gmail history checkpoint changed');
        const insert=this.db.prepare('INSERT OR IGNORE INTO gmail_arrivals VALUES (?,?)');
        const record=this.db.prepare('INSERT INTO gmail_arrival_evidence VALUES (?,?,?)');
        for(const id of messages)if(insert.run(accountId,id).changes===1)record.run(accountId,id,evidence.get(id)??'unknown');
        this.db.prepare("UPDATE gmail_monitor_runs SET outcome='completed',finished_at=? WHERE id=? AND outcome='running'").run(Date.now(),runId);
        this.db.exec('COMMIT');
      } catch(error){this.db.exec('ROLLBACK');throw error;}
    } catch(error) {
      const expired=error instanceof GmailHistoryExpired;
      try {this.assertAuthority();} catch {
        this.db.prepare("UPDATE gmail_monitor_runs SET outcome='interrupted',finished_at=? WHERE id=? AND outcome='running'").run(Date.now(),runId);
        throw error;
      }
      this.db.prepare('UPDATE gmail_history SET state=?,detail=? WHERE account_id=? AND cursor=?').run(expired?'uncertain':'failed',expired?'History expired; arrivals during the gap are unknown':'History scan failed; retry is safe',accountId,cursor);
      this.db.prepare("UPDATE gmail_monitor_runs SET outcome=?,finished_at=? WHERE id=? AND outcome='running'").run(expired?'uncertain':'failed',Date.now(),runId);
      throw error;
    }
    return this.status(accountId);
  }
}
