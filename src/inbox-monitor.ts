import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';

export const inboxMonitorSchema = `
CREATE TABLE IF NOT EXISTS inbox_monitor_settings (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, enabled INTEGER NOT NULL, account_id TEXT NOT NULL, bot_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, agent_revision TEXT NOT NULL, gmail_revision INTEGER NOT NULL, slack_revision INTEGER NOT NULL, attention TEXT NOT NULL, sensitive_terms TEXT NOT NULL, start_seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_monitor_items (account_id TEXT NOT NULL, message_id TEXT NOT NULL, settings_revision INTEGER NOT NULL, attempt_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, forced_private INTEGER NOT NULL DEFAULT 0, summary TEXT, clarification_ts TEXT, PRIMARY KEY(account_id,message_id));
CREATE TABLE IF NOT EXISTS inbox_monitor_replies (event_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS inbox_monitor_failure (revision INTEGER NOT NULL, code TEXT NOT NULL, notified INTEGER NOT NULL, PRIMARY KEY(revision,code));
`;
export const inboxPreferencesSchema=z.strictObject({enabled:z.boolean(),attention:z.string().trim().max(2000),sensitiveTerms:z.array(z.string().trim().min(1).max(100)).max(50)});
export type InboxPreferences=z.infer<typeof inboxPreferencesSchema>;

export class InboxMonitorStore {
 constructor(private readonly db:DatabaseSync) {}
 recover() {this.db.exec("UPDATE inbox_monitor_items SET state='uncertain' WHERE state IN ('sending','sending_clarification','sending_approved')");}
 settings() {
  const row=this.db.prepare('SELECT * FROM inbox_monitor_settings WHERE id=1').get();if(!row)return null;
  return {revision:Number(row.revision),enabled:row.enabled===1,accountId:String(row.account_id),botId:String(row.bot_id),provider:String(row.provider),model:String(row.model),agentRevision:String(row.agent_revision),gmailRevision:Number(row.gmail_revision),slackRevision:Number(row.slack_revision),attention:String(row.attention),sensitiveTerms:z.array(z.string()).parse(JSON.parse(String(row.sensitive_terms))),startSeq:Number(row.start_seq)};
 }
 status() {return {items:this.db.prepare('SELECT attempt_id AS attemptId,state FROM inbox_monitor_items ORDER BY rowid DESC LIMIT 30').all(),failure:this.db.prepare('SELECT code FROM inbox_monitor_failure ORDER BY rowid DESC LIMIT 1').get()?.code ?? null};}
 configure(input:InboxPreferences & {accountId:string;botId:string;provider:string;model:string;agentRevision:string;gmailRevision:number;slackRevision:number}) {
  const prior=this.settings();const seq=this.db.prepare('SELECT COALESCE(MAX(rowid),0) AS seq FROM gmail_arrivals WHERE account_id=?').get(input.accountId);
  this.db.exec('BEGIN IMMEDIATE');try {
   this.db.prepare("UPDATE inbox_monitor_items SET state='stale' WHERE state IN ('ready','clarify','awaiting','approved')").run();
   this.db.prepare('DELETE FROM inbox_monitor_failure').run();
   this.db.prepare("DELETE FROM slack_notices WHERE id LIKE 'inbox-failure-%' AND state='pending'").run();
   this.db.prepare(`INSERT INTO inbox_monitor_settings VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled,account_id=excluded.account_id,bot_id=excluded.bot_id,provider=excluded.provider,model=excluded.model,agent_revision=excluded.agent_revision,gmail_revision=excluded.gmail_revision,slack_revision=excluded.slack_revision,attention=excluded.attention,sensitive_terms=excluded.sensitive_terms,start_seq=excluded.start_seq`).run((prior?.revision??0)+1,Number(input.enabled),input.accountId,input.botId,input.provider,input.model,input.agentRevision,input.gmailRevision,input.slackRevision,input.attention,JSON.stringify(input.sensitiveTerms),Number(seq?.seq??0));
   this.db.exec('COMMIT');
  } catch(error){this.db.exec('ROLLBACK');throw error;}
  return this.settings()!;
 }
 next() {const s=this.settings();if(!s?.enabled)return null;const row=this.db.prepare('SELECT message_id FROM gmail_arrivals a WHERE account_id=? AND rowid>? AND NOT EXISTS (SELECT 1 FROM inbox_monitor_items i WHERE i.account_id=a.account_id AND i.message_id=a.message_id) ORDER BY rowid LIMIT 1').get(s.accountId,s.startSeq);return typeof row?.message_id==='string'?row.message_id:null;}
 add(accountId:string,messageId:string,revision:number,attemptId:string) {this.db.prepare("INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state) VALUES (?,?,?,?,'evaluating')").run(accountId,messageId,revision,attemptId);}
 item(attemptId:string) {return this.db.prepare('SELECT * FROM inbox_monitor_items WHERE attempt_id=?').get(attemptId);}
 pending() {return this.db.prepare("SELECT * FROM inbox_monitor_items WHERE state='evaluating' ORDER BY rowid").all();}
 deliveries() {return this.db.prepare("SELECT * FROM inbox_monitor_items WHERE state IN ('ready','clarify','approved') ORDER BY rowid LIMIT 20").all();}
 forcePrivate(attemptId:string) {this.db.prepare('UPDATE inbox_monitor_items SET forced_private=1 WHERE attempt_id=?').run(attemptId);}
 setResult(attemptId:string,state:'ignored'|'ready'|'clarify'|'failed',summary:string|null) {this.db.prepare("UPDATE inbox_monitor_items SET state=?,summary=? WHERE attempt_id=? AND state='evaluating'").run(state,summary,attemptId);}
 setState(attemptId:string,from:string,to:string) {return this.db.prepare('UPDATE inbox_monitor_items SET state=? WHERE attempt_id=? AND state=?').run(to,attemptId,from).changes===1;}
 awaiting(thread:string) {return this.db.prepare("SELECT * FROM inbox_monitor_items WHERE state='awaiting' AND clarification_ts=?").get(thread);}
 replySeen(eventId:string) {return !!this.db.prepare('SELECT 1 FROM inbox_monitor_replies WHERE event_id=?').get(eventId);}
 markClarification(attemptId:string,ts:string) {this.db.prepare("UPDATE inbox_monitor_items SET state='awaiting',clarification_ts=? WHERE attempt_id=? AND state='sending_clarification'").run(ts,attemptId);}
 resolveReply(eventId:string,attemptId:string,decision:'approved'|'declined') {
  this.db.exec('BEGIN IMMEDIATE');try {
   const inserted=this.db.prepare('INSERT OR IGNORE INTO inbox_monitor_replies VALUES (?)').run(eventId);
   const changed=inserted.changes===1 && this.setState(attemptId,'awaiting',decision);
   this.db.exec('COMMIT');return changed;
  } catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 failure(revision:number,code:string|null,notice?:{id:string;teamId:string;userId:string;channelId:string;botId:string;text:string}) {
  if(!code){this.db.prepare('DELETE FROM inbox_monitor_failure WHERE revision=?').run(revision);return;}
  const old=this.db.prepare('SELECT notified FROM inbox_monitor_failure WHERE revision=? AND code=?').get(revision,code);
  if(old && (old.notified===1 || !notice))return;
  this.db.exec('BEGIN IMMEDIATE');try {
   this.db.prepare('INSERT INTO inbox_monitor_failure VALUES (?,?,?) ON CONFLICT(revision,code) DO UPDATE SET notified=excluded.notified').run(revision,code,Number(!!notice));
   if(notice)this.db.prepare("INSERT OR IGNORE INTO slack_notices VALUES (?,?,?,?,NULL,?,?,'pending',0)").run(notice.id,notice.teamId,notice.userId,notice.channelId,notice.botId,notice.text);
   this.db.exec('COMMIT');
  } catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 recoverFailure(revision:number,codes:string[]) {
  this.db.exec('BEGIN IMMEDIATE');try {
   for(const code of codes){this.db.prepare('DELETE FROM inbox_monitor_failure WHERE revision=? AND code=?').run(revision,code);this.db.prepare("DELETE FROM slack_notices WHERE id LIKE ? AND state='pending'").run(`inbox-failure-${revision}-${code}-%`);}
   this.db.exec('COMMIT');
  } catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 unavailable(accountId:string) {const now=Date.now();this.db.prepare("INSERT INTO gmail_monitor_runs (account_id,started_at,finished_at,outcome) VALUES (?,?,?,'failed')").run(accountId,now,now);}
}
