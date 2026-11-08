import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';

// The cursor and all arrivals from a complete history scan are committed together.
export const gmailHistorySchema = `
CREATE TABLE IF NOT EXISTS gmail_history (account_id TEXT PRIMARY KEY, cursor TEXT NOT NULL, state TEXT NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS gmail_arrivals (account_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(account_id,message_id));`;

const profileSchema=z.object({emailAddress:z.email(),historyId:z.string().regex(/^\d+$/)});
const pageSchema=z.object({historyId:z.string().regex(/^\d+$/),nextPageToken:z.string().min(1).optional(),inboxMessageIds:z.array(z.string().min(1).max(200)).max(10000)});
export interface GmailHistoryTransport {
  profile():Promise<unknown>;
  // Return only message-added events selected by the Gmail INBOX history filter.
  history(input:{startHistoryId:string;pageToken?:string}):Promise<unknown>;
}
export class GmailHistoryExpired extends Error {
  constructor(){super('Gmail history expired; the interval cannot be reconstructed');}
}

export class GmailHistory {
  constructor(private readonly db:DatabaseSync,private readonly transport:GmailHistoryTransport) {}

  status(accountId:string) {
    const row=this.db.prepare('SELECT cursor,state,detail FROM gmail_history WHERE account_id=?').get(accountId);
    if(!row || typeof row.cursor!=='string' || typeof row.state!=='string' || !(row.detail===null || typeof row.detail==='string'))throw Error('Gmail baseline unavailable');
    return {cursor:row.cursor,state:row.state,detail:row.detail};
  }

  arrivals(accountId:string) {
    return this.db.prepare('SELECT message_id AS messageId FROM gmail_arrivals WHERE account_id=? ORDER BY rowid').all(accountId).map(row=>({messageId:String(row.messageId)}));
  }

  async connect(accountId:string) {
    const profile=profileSchema.parse(await this.transport.profile());
    if(profile.emailAddress.toLowerCase()!==accountId.toLowerCase())throw Error('Gmail account does not match the selected account');
    this.db.prepare("INSERT OR IGNORE INTO gmail_history VALUES (?,?,'ready',NULL)").run(accountId,profile.historyId);
    return this.status(accountId);
  }

  async poll(accountId:string) {
    const {cursor}=this.status(accountId),messages=new Set<string>(),tokens=new Set<string>();
    let pageToken:string|undefined,latest=cursor;
    try {
      for(let page=0;;page++) {
        if(page>=100)throw Error('Gmail history scan exceeds the page limit');
        const result=pageSchema.parse(await this.transport.history({startHistoryId:cursor,...(pageToken?{pageToken}:{})}));
        latest=result.historyId;
        for(const id of result.inboxMessageIds)messages.add(id);
        if(messages.size>10000)throw Error('Gmail history scan exceeds the arrival limit');
        if(!result.nextPageToken)break;
        if(tokens.has(result.nextPageToken))throw Error('Gmail history pagination repeated');
        tokens.add(result.nextPageToken);pageToken=result.nextPageToken;
      }
      if(BigInt(latest)<BigInt(cursor))throw Error('Gmail history cursor moved backwards');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const changed=this.db.prepare("UPDATE gmail_history SET cursor=?,state='ready',detail=NULL WHERE account_id=? AND cursor=?").run(latest,accountId,cursor);
        if(changed.changes!==1)throw Error('Gmail history checkpoint changed');
        const insert=this.db.prepare('INSERT OR IGNORE INTO gmail_arrivals VALUES (?,?)');
        for(const id of messages)insert.run(accountId,id);
        this.db.exec('COMMIT');
      } catch(error){this.db.exec('ROLLBACK');throw error;}
    } catch(error) {
      const expired=error instanceof GmailHistoryExpired;
      this.db.prepare('UPDATE gmail_history SET state=?,detail=? WHERE account_id=? AND cursor=?').run(expired?'uncertain':'failed',expired?'History expired; arrivals during the gap are unknown':'History scan failed; retry is safe',accountId,cursor);
      throw error;
    }
    return this.status(accountId);
  }
}
