import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';

export const inboxMonitorSchema = `
CREATE TABLE IF NOT EXISTS inbox_monitor_settings (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, enabled INTEGER NOT NULL, account_id TEXT NOT NULL, bot_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, agent_revision TEXT NOT NULL, gmail_revision INTEGER NOT NULL, slack_revision INTEGER NOT NULL, attention TEXT NOT NULL, sensitive_terms TEXT NOT NULL, start_seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_monitor_items (account_id TEXT NOT NULL, message_id TEXT NOT NULL, settings_revision INTEGER NOT NULL, attempt_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, forced_private INTEGER NOT NULL DEFAULT 0, summary TEXT, clarification_ts TEXT, PRIMARY KEY(account_id,message_id));
CREATE TABLE IF NOT EXISTS inbox_monitor_replies (event_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS inbox_candidate_reviews (account_id TEXT NOT NULL,message_id TEXT NOT NULL,settings_revision INTEGER NOT NULL,PRIMARY KEY(account_id,message_id));
CREATE TABLE IF NOT EXISTS inbox_delivery_retry (kind TEXT NOT NULL,id TEXT NOT NULL,retry_at INTEGER NOT NULL,PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS inbox_sensitive_corrections (account_id TEXT NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(account_id,message_id));
CREATE TABLE IF NOT EXISTS inbox_correction_events (event_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,message_id TEXT NOT NULL,correction TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_legacy_corrections (account_id TEXT NOT NULL,message_id TEXT NOT NULL,correction TEXT NOT NULL,PRIMARY KEY(account_id,message_id));
CREATE TABLE IF NOT EXISTS inbox_assessment_history (attempt_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,message_id TEXT NOT NULL,snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_digest_history (batch_id TEXT NOT NULL,attempt_id TEXT NOT NULL,PRIMARY KEY(batch_id,attempt_id));
CREATE TABLE IF NOT EXISTS inbox_digest_archive (batch_id TEXT PRIMARY KEY,snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_monitor_failure (revision INTEGER NOT NULL, code TEXT NOT NULL, notified INTEGER NOT NULL, PRIMARY KEY(revision,code));
`;
export const inboxPreferencesSchema=z.strictObject({enabled:z.boolean(),attention:z.string().trim().max(2000),sensitiveTerms:z.array(z.string().trim().min(1).max(100)).max(50),digestMinutes:z.number().int().min(1).max(1440).default(60),memoryContext:z.boolean().default(false)});
export type InboxPreferences=z.infer<typeof inboxPreferencesSchema>;
export const inboxClarification='I found an email that may need private handling. Would you like me to share its details here? Please reply in this thread.';
export const inboxMessage=(summary:string)=>`New Gmail candidate: ${summary.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}\nGmail history does not establish whether this message was in the inbox when it arrived.`;
export const inboxUncertainMessage=(from:unknown,summary:unknown)=>from==='sending_clarification'?inboxClarification:(from==='sending' || from==='sending_approved') && typeof summary==='string'?inboxMessage(summary):'The original delivery type is unknown; its exact attempted text cannot be reconstructed.';

export class InboxMonitorStore {
 constructor(private readonly db:DatabaseSync) {}
 recover() {this.db.exec("UPDATE inbox_monitor_items SET uncertain_from=state,state='uncertain' WHERE state IN ('sending','sending_clarification','sending_approved'); UPDATE inbox_digest_batches SET state='uncertain' WHERE state='sending'");}
 settings() {
  const row=this.db.prepare('SELECT * FROM inbox_monitor_settings WHERE id=1').get();if(!row)return null;
  return {revision:Number(row.revision),enabled:row.enabled===1,accountId:String(row.account_id),botId:String(row.bot_id),provider:String(row.provider),model:String(row.model),agentRevision:String(row.agent_revision),gmailRevision:Number(row.gmail_revision),slackRevision:Number(row.slack_revision),attention:String(row.attention),sensitiveTerms:z.array(z.string()).parse(JSON.parse(String(row.sensitive_terms))),startSeq:Number(row.start_seq),digestMinutes:Number(row.digest_minutes),nextDigestAt:Number(row.next_digest_at),memoryContext:row.memory_context===1};
 }
 status() {return {items:this.db.prepare("SELECT attempt_id AS attemptId,message_id AS messageId,state,urgency,correction,EXISTS(SELECT 1 FROM inbox_sensitive_corrections s WHERE s.account_id=inbox_monitor_items.account_id AND s.message_id=inbox_monitor_items.message_id) AS sensitiveActive,CASE WHEN state IN ('uncertain','rate_limit_review') OR (state='delivered' AND correction IS NOT NULL) THEN summary END AS summary,uncertain_from AS uncertainFrom FROM inbox_monitor_items ORDER BY CASE WHEN state IN ('uncertain','rate_limit_review') THEN 0 ELSE 1 END,rowid DESC LIMIT 30").all().map(row=>({...row,preview:(row.state==='uncertain' || row.state==='rate_limit_review')?inboxUncertainMessage(row.uncertainFrom,row.summary):null})),digests:this.db.prepare("SELECT id,state,CASE WHEN state IN ('uncertain','rate_limit_review') THEN text END AS text FROM inbox_digest_batches ORDER BY CASE WHEN state IN ('uncertain','rate_limit_review') THEN 0 ELSE 1 END,rowid DESC LIMIT 30").all(),failure:this.db.prepare('SELECT code FROM inbox_monitor_failure ORDER BY rowid DESC LIMIT 1').get()?.code ?? null};}
 annotateArrivals<T extends {messageId:string}>(accountId:string,arrivals:T[]) {
  const lookup=this.db.prepare('SELECT attempt_id,state FROM inbox_monitor_items WHERE account_id=? AND message_id=?');
  return arrivals.map(arrival=>{const row=lookup.get(accountId,arrival.messageId);return {...arrival,assessmentExists:!!row,retryAttemptId:row && (row.state==='failed' || row.state==='stale') && typeof row.attempt_id==='string'?row.attempt_id:null};});
 }
 configure(input:InboxPreferences & {accountId:string;botId:string;provider:string;model:string;agentRevision:string;gmailRevision:number;slackRevision:number},now=Date.now()) {
  const prior=this.settings();
  const sameAuthority=!!prior?.enabled && input.enabled && prior.accountId===input.accountId && prior.botId===input.botId && prior.provider===input.provider && prior.model===input.model && prior.agentRevision===input.agentRevision && prior.gmailRevision===input.gmailRevision && prior.slackRevision===input.slackRevision;
  const compatible=sameAuthority && prior!.memoryContext===input.memoryContext && JSON.stringify(prior!.sensitiveTerms)===JSON.stringify(input.sensitiveTerms);
  const revision=(prior?.revision??0)+1;
  this.db.exec('BEGIN IMMEDIATE');try {
   if(compatible){this.db.prepare("UPDATE inbox_monitor_items SET settings_revision=? WHERE state IN ('evaluating','ready','clarify','awaiting','approved','sending','sending_clarification','sending_approved','delivered','retry','digest_pending','digest_batched','uncertain') AND settings_revision=?").run(revision,prior!.revision);this.db.prepare("UPDATE inbox_digest_batches SET settings_revision=? WHERE state IN ('pending','sending','uncertain') AND settings_revision=?").run(revision,prior!.revision);this.db.prepare('UPDATE inbox_candidate_reviews SET settings_revision=? WHERE settings_revision=?').run(revision,prior!.revision);}
   else if(sameAuthority){
    this.db.prepare("UPDATE inbox_monitor_items SET recheck_private=1,settings_revision=? WHERE state IN ('sending','sending_approved') AND settings_revision=?").run(revision,prior!.revision);
    this.db.prepare("UPDATE inbox_monitor_items SET settings_revision=? WHERE state IN ('sending_clarification','delivered') AND settings_revision=?").run(revision,prior!.revision);
    this.db.prepare("UPDATE inbox_monitor_items SET recheck_private=1,settings_revision=? WHERE state='digest_batched' AND attempt_id IN (SELECT attempt_id FROM inbox_digest_items JOIN inbox_digest_batches ON id=batch_id WHERE inbox_digest_batches.state='sending' AND inbox_digest_batches.settings_revision=?)").run(revision,prior!.revision);
    this.db.prepare("UPDATE inbox_digest_batches SET settings_revision=? WHERE state='sending' AND settings_revision=?").run(revision,prior!.revision);
    this.db.prepare("UPDATE inbox_monitor_items SET state='clarify',forced_private=1,settings_revision=? WHERE state IN ('ready','approved') AND settings_revision=?").run(revision,prior!.revision);
    this.db.prepare("UPDATE inbox_monitor_items SET settings_revision=? WHERE state IN ('clarify','awaiting') AND settings_revision=?").run(revision,prior!.revision);
    const batches=this.db.prepare("SELECT id FROM inbox_digest_batches WHERE state='pending' AND settings_revision=?").all(prior!.revision);
    for(const batch of batches){const id=String(batch.id);this.splitDigest(id,revision,true);}
    this.db.prepare("UPDATE inbox_monitor_items SET state='clarify',forced_private=1,settings_revision=? WHERE state='digest_pending' AND settings_revision=?").run(revision,prior!.revision);
   } else {this.db.prepare("UPDATE inbox_monitor_items SET state='stale' WHERE state IN ('ready','clarify','awaiting','approved','digest_pending') OR (state='digest_batched' AND attempt_id IN (SELECT attempt_id FROM inbox_digest_items JOIN inbox_digest_batches ON id=batch_id WHERE inbox_digest_batches.state='pending'))").run();this.db.prepare("UPDATE inbox_digest_batches SET state='stale' WHERE state='pending'").run();}
   if(!compatible){this.db.prepare("UPDATE inbox_monitor_items SET state='failed' WHERE state='retry'").run();this.db.prepare('DELETE FROM inbox_candidate_reviews').run();}
   this.db.prepare('DELETE FROM inbox_monitor_failure').run();
   this.db.prepare("DELETE FROM slack_notices WHERE id LIKE 'inbox-failure-%' AND state='pending'").run();
   this.db.prepare(`INSERT INTO inbox_monitor_settings (id,revision,enabled,account_id,bot_id,provider,model,agent_revision,gmail_revision,slack_revision,attention,sensitive_terms,start_seq,digest_minutes,next_digest_at,memory_context) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled,account_id=excluded.account_id,bot_id=excluded.bot_id,provider=excluded.provider,model=excluded.model,agent_revision=excluded.agent_revision,gmail_revision=excluded.gmail_revision,slack_revision=excluded.slack_revision,attention=excluded.attention,sensitive_terms=excluded.sensitive_terms,start_seq=excluded.start_seq,digest_minutes=excluded.digest_minutes,next_digest_at=excluded.next_digest_at,memory_context=excluded.memory_context`).run(revision,Number(input.enabled),input.accountId,input.botId,input.provider,input.model,input.agentRevision,input.gmailRevision,input.slackRevision,input.attention,JSON.stringify(input.sensitiveTerms),prior?.accountId===input.accountId?prior.startSeq:0,input.digestMinutes,compatible && prior!.digestMinutes===input.digestMinutes?prior!.nextDigestAt:now+input.digestMinutes*60000,Number(input.memoryContext));
   this.db.exec('COMMIT');
  } catch(error){this.db.exec('ROLLBACK');throw error;}
  return this.settings()!;
 }
 next() {const s=this.settings();if(!s?.enabled)return null;const row=this.db.prepare("SELECT a.message_id FROM gmail_arrivals a LEFT JOIN gmail_arrival_evidence e ON e.account_id=a.account_id AND e.message_id=a.message_id LEFT JOIN inbox_monitor_items i ON i.account_id=a.account_id AND i.message_id=a.message_id LEFT JOIN inbox_candidate_reviews r ON r.account_id=a.account_id AND r.message_id=a.message_id AND r.settings_revision=? WHERE a.account_id=? AND (a.rowid>? OR r.message_id IS NOT NULL OR i.state='retry') AND ((i.state='retry' AND i.settings_revision=?) OR (i.attempt_id IS NULL AND (e.inbox='yes' OR (COALESCE(e.inbox,'unknown')='unknown' AND r.message_id IS NOT NULL)))) ORDER BY a.rowid LIMIT 1").get(s.revision,s.accountId,s.startSeq,s.revision);return typeof row?.message_id==='string'?row.message_id:null;}
 reviewCandidate(accountId:string,messageId:string,revision:number) {
  const evidence=this.db.prepare("SELECT COALESCE(e.inbox,'unknown') AS inbox,i.attempt_id,i.state FROM gmail_arrivals a LEFT JOIN gmail_arrival_evidence e ON e.account_id=a.account_id AND e.message_id=a.message_id LEFT JOIN inbox_monitor_items i ON i.account_id=a.account_id AND i.message_id=a.message_id WHERE a.account_id=? AND a.message_id=?").get(accountId,messageId);
  if(evidence?.inbox!=='unknown')throw Error('Candidate is no longer available for review');
  if(typeof evidence.attempt_id==='string') {if(evidence.state!=='stale')throw Error('Candidate is no longer available for review');this.retryEvaluation(evidence.attempt_id,revision);return;}
  this.db.prepare('INSERT INTO inbox_candidate_reviews VALUES (?,?,?) ON CONFLICT(account_id,message_id) DO UPDATE SET settings_revision=excluded.settings_revision').run(accountId,messageId,revision);
 }
 retryEvaluation(attemptId:string,revision:number) {
  this.db.exec('BEGIN IMMEDIATE');try {
   const item=this.item(attemptId);if(!item || (item.state!=='failed' && item.state!=='stale'))throw Error('Evaluation is no longer available to retry');
   if(this.db.prepare("SELECT 1 FROM inbox_digest_items d JOIN inbox_digest_batches b ON b.id=d.batch_id WHERE d.attempt_id=? AND b.state<>'stale'").get(attemptId))throw Error('Digest delivery requires review before reassessment');
   this.db.prepare("UPDATE inbox_monitor_items SET state='stale' WHERE state='digest_batched' AND attempt_id IN (SELECT d2.attempt_id FROM inbox_digest_items d1 JOIN inbox_digest_batches b ON b.id=d1.batch_id JOIN inbox_digest_items d2 ON d2.batch_id=b.id WHERE d1.attempt_id=? AND b.state='stale')").run(attemptId);
   for(const batch of this.db.prepare('SELECT batch_id FROM inbox_digest_items WHERE attempt_id=?').all(attemptId)){const deadline=this.retryDeadline('digest',String(batch.batch_id));if(deadline)this.setRetryDeadline('item',attemptId,deadline);}
   this.db.prepare('INSERT OR IGNORE INTO inbox_digest_history SELECT batch_id,attempt_id FROM inbox_digest_items WHERE attempt_id=?').run(attemptId);
   this.db.prepare('DELETE FROM inbox_digest_items WHERE attempt_id=?').run(attemptId);
   this.db.prepare('INSERT OR IGNORE INTO inbox_assessment_history VALUES (?,?,?,?)').run(attemptId,String(item.account_id),String(item.message_id),JSON.stringify(item));
   this.db.prepare("UPDATE inbox_monitor_items SET state='retry',settings_revision=?,forced_private=CASE WHEN state='stale' THEN 1 ELSE forced_private END WHERE attempt_id=?").run(revision,attemptId);
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 add(accountId:string,messageId:string,revision:number,attemptId:string) {const prior=this.db.prepare('SELECT attempt_id FROM inbox_monitor_items WHERE account_id=? AND message_id=? AND state=\'retry\'').get(accountId,messageId);const deadline=typeof prior?.attempt_id==='string'?this.retryDeadline('item',prior.attempt_id):0;this.db.prepare("INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state,forced_private) VALUES (?,?,?,?,'evaluating',CASE WHEN NOT EXISTS (SELECT 1 FROM gmail_arrival_evidence WHERE account_id=? AND message_id=? AND inbox='yes') THEN 1 ELSE 0 END) ON CONFLICT(account_id,message_id) DO UPDATE SET settings_revision=excluded.settings_revision,attempt_id=excluded.attempt_id,state='evaluating',summary=NULL,recheck_private=0,forced_private=MAX(inbox_monitor_items.forced_private,excluded.forced_private) WHERE inbox_monitor_items.state='retry'").run(accountId,messageId,revision,attemptId,accountId,messageId);if(deadline)this.setRetryDeadline('item',attemptId,deadline);this.db.prepare('DELETE FROM inbox_candidate_reviews WHERE account_id=? AND message_id=?').run(accountId,messageId);}
 item(attemptId:string) {return this.db.prepare('SELECT * FROM inbox_monitor_items WHERE attempt_id=?').get(attemptId);}
 pending() {return this.db.prepare("SELECT * FROM inbox_monitor_items WHERE state='evaluating' ORDER BY rowid").all();}
 deliveries(now=Date.now()) {return this.db.prepare("SELECT * FROM inbox_monitor_items WHERE state IN ('ready','clarify','approved') AND NOT EXISTS (SELECT 1 FROM inbox_delivery_retry r WHERE r.kind='item' AND r.id=attempt_id AND r.retry_at>?) ORDER BY rowid LIMIT 20").all(now);}
 private retryDeadline(kind:'item'|'digest',id:string) {const row=this.db.prepare('SELECT retry_at FROM inbox_delivery_retry WHERE kind=? AND id=?').get(kind,id);return typeof row?.retry_at==='number'?row.retry_at:0;}
 private setRetryDeadline(kind:'item'|'digest',id:string,retryAt:number) {this.db.prepare('INSERT INTO inbox_delivery_retry VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at)').run(kind,id,retryAt);}
 private splitDigest(id:string,revision:number,privateAll:boolean,retryAt=0) {
  const deadline=Math.max(retryAt,this.retryDeadline('digest',id)),batch=this.db.prepare('SELECT * FROM inbox_digest_batches WHERE id=?').get(id);
  if(batch)this.db.prepare('INSERT OR IGNORE INTO inbox_digest_archive VALUES (?,?)').run(id,JSON.stringify(batch));
  this.db.prepare('INSERT OR IGNORE INTO inbox_digest_history SELECT batch_id,attempt_id FROM inbox_digest_items WHERE batch_id=?').run(id);
  const rows=this.db.prepare("SELECT attempt_id,recheck_private FROM inbox_monitor_items WHERE state='digest_batched' AND attempt_id IN (SELECT attempt_id FROM inbox_digest_items WHERE batch_id=?)").all(id);
  for(const row of rows){const attempt=String(row.attempt_id),makePrivate=privateAll || row.recheck_private===1 || this.hasSensitiveFeedback(attempt);this.db.prepare("UPDATE inbox_monitor_items SET state=?,forced_private=CASE WHEN ? THEN 1 ELSE forced_private END,recheck_private=0,settings_revision=? WHERE attempt_id=? AND state='digest_batched'").run(makePrivate?'clarify':'digest_pending',Number(makePrivate),revision,attempt);if(deadline)this.setRetryDeadline('item',attempt,deadline);}
  this.db.prepare('DELETE FROM inbox_digest_items WHERE batch_id=?').run(id);this.db.prepare('DELETE FROM inbox_digest_batches WHERE id=?').run(id);this.db.prepare("DELETE FROM inbox_delivery_retry WHERE kind='digest' AND id=?").run(id);
 }
 deferDelivery(kind:'item'|'digest',id:string,from:string,to:string,retryAt:number|null,authority=true) {
  this.db.exec('BEGIN IMMEDIATE');try {
   const settings=this.settings(),row=kind==='item'?this.item(id):this.db.prepare('SELECT * FROM inbox_digest_batches WHERE id=?').get(id);
   if(!row || row.state!==from){this.db.exec('COMMIT');return;}
   if(retryAt===null){if(kind==='item')this.db.prepare("UPDATE inbox_monitor_items SET state='rate_limit_review',uncertain_from=? WHERE attempt_id=? AND state=?").run(from,id,from);else this.setBatchState(id,from,'rate_limit_review');this.db.exec('COMMIT');return;}
   if(!authority || !settings?.enabled || row.settings_revision!==settings.revision){
    if(kind==='item'){this.setState(id,from,'stale');this.setRetryDeadline('item',id,retryAt);}else {this.setBatchState(id,from,'stale');this.setRetryDeadline('digest',id,retryAt);this.db.prepare("UPDATE inbox_monitor_items SET state='stale' WHERE state='digest_batched' AND attempt_id IN (SELECT attempt_id FROM inbox_digest_items WHERE batch_id=?)").run(id);}
   } else if(kind==='item') {
    const privateAgain=from!=='sending_clarification' && (row.recheck_private===1 || (from==='sending' && this.hasSensitiveFeedback(id)));
    this.db.prepare("UPDATE inbox_monitor_items SET state=?,forced_private=CASE WHEN ? THEN 1 ELSE forced_private END,recheck_private=0 WHERE attempt_id=? AND state=?").run(privateAgain?'clarify':to,Number(privateAgain),id,from);this.setRetryDeadline('item',id,retryAt);
   } else {
    const members=this.db.prepare("SELECT attempt_id,recheck_private FROM inbox_monitor_items WHERE state='digest_batched' AND attempt_id IN (SELECT attempt_id FROM inbox_digest_items WHERE batch_id=?)").all(id);
    if(members.some(member=>member.recheck_private===1 || this.hasSensitiveFeedback(String(member.attempt_id))))this.splitDigest(id,settings.revision,false,retryAt);
    else {this.setBatchState(id,from,to);this.setRetryDeadline('digest',id,retryAt);}
   }
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 forcePrivate(attemptId:string) {this.db.prepare('UPDATE inbox_monitor_items SET forced_private=1 WHERE attempt_id=?').run(attemptId);}
 sender(attemptId:string,key:string) {this.db.prepare('UPDATE inbox_monitor_items SET sender_key=? WHERE attempt_id=?').run(key,attemptId);}
 feedback(attemptId:string) {return this.db.prepare("SELECT correction FROM inbox_monitor_items WHERE sender_key=(SELECT sender_key FROM inbox_monitor_items WHERE attempt_id=?) AND correction IS NOT NULL AND attempt_id<>? ORDER BY rowid DESC LIMIT 5").all(attemptId,attemptId).map(row=>String(row.correction));}
 hasSensitiveFeedback(attemptId:string) {return !!this.db.prepare("SELECT 1 FROM inbox_monitor_items i WHERE i.sender_key=(SELECT sender_key FROM inbox_monitor_items WHERE attempt_id=?) AND i.attempt_id<>? AND (i.correction='sensitive' OR EXISTS (SELECT 1 FROM inbox_sensitive_corrections s WHERE s.account_id=i.account_id AND s.message_id=i.message_id)) LIMIT 1").get(attemptId,attemptId);}
 setResult(attemptId:string,state:'ignored'|'ready'|'clarify'|'failed'|'digest_pending',summary:string|null,urgency?:string) {this.db.prepare("UPDATE inbox_monitor_items SET state=?,summary=?,urgency=? WHERE attempt_id=? AND state='evaluating'").run(state,summary,urgency??null,attemptId);}
 setState(attemptId:string,from:string,to:string) {return this.db.prepare('UPDATE inbox_monitor_items SET state=? WHERE attempt_id=? AND state=?').run(to,attemptId,from).changes===1;}
 awaiting(thread:string) {return this.db.prepare("SELECT * FROM inbox_monitor_items WHERE state='awaiting' AND clarification_ts=?").get(thread);}
 replySeen(eventId:string) {return !!this.db.prepare('SELECT 1 FROM inbox_monitor_replies WHERE event_id=?').get(eventId);}
 markClarification(attemptId:string,ts:string) {this.db.prepare("UPDATE inbox_monitor_items SET state='awaiting',clarification_ts=? WHERE attempt_id=? AND state='sending_clarification'").run(ts,attemptId);}
 markDelivered(attemptId:string,from:string,ts:string|null) {this.db.prepare("UPDATE inbox_monitor_items SET state='delivered',delivery_ts=? WHERE attempt_id=? AND state=?").run(ts,attemptId,from);}
 markUncertain(attemptId:string,from:string) {this.db.prepare("UPDATE inbox_monitor_items SET state='uncertain',uncertain_from=? WHERE attempt_id=? AND state=?").run(from,attemptId,from);}
 delivered(thread:string) {return this.db.prepare("SELECT * FROM inbox_monitor_items WHERE state='delivered' AND delivery_ts=? ORDER BY rowid").all(thread);}
 correct(eventId:string,attemptId:string,correction:'urgent'|'less-urgent'|'sensitive'|'not-sensitive'|'clear') {
  this.db.exec('BEGIN IMMEDIATE');try {
   const inserted=this.db.prepare('INSERT OR IGNORE INTO inbox_monitor_replies VALUES (?)').run(eventId);
   const changed=inserted.changes===1 && this.db.prepare("UPDATE inbox_monitor_items SET correction=? WHERE attempt_id=? AND state IN ('delivered','awaiting')").run(correction==='clear'?null:correction,attemptId).changes===1;
   if(changed) {
    const item=this.item(attemptId)!;this.db.prepare('INSERT INTO inbox_correction_events VALUES (?,?,?,?)').run(eventId,String(item.account_id),String(item.message_id),correction);
    if(correction==='sensitive')this.db.prepare('INSERT OR IGNORE INTO inbox_sensitive_corrections VALUES (?,?)').run(String(item.account_id),String(item.message_id));
    if(correction==='clear')this.db.prepare('DELETE FROM inbox_sensitive_corrections WHERE account_id=? AND message_id=?').run(String(item.account_id),String(item.message_id));
   }
   if(changed && correction==='sensitive') {
    const key=this.db.prepare('SELECT sender_key FROM inbox_monitor_items WHERE attempt_id=?').get(attemptId)?.sender_key;
    if(typeof key==='string') {
     const batches=this.db.prepare("SELECT DISTINCT b.id,b.settings_revision FROM inbox_digest_batches b JOIN inbox_digest_items d ON d.batch_id=b.id JOIN inbox_monitor_items i ON i.attempt_id=d.attempt_id WHERE b.state='pending' AND i.sender_key=?").all(key);
     for(const batch of batches){const id=String(batch.id);this.splitDigest(id,Number(batch.settings_revision),false);}
     this.db.prepare("UPDATE inbox_monitor_items SET state='clarify',forced_private=1 WHERE sender_key=? AND state IN ('ready','digest_pending')").run(key);
     this.db.prepare("UPDATE inbox_monitor_items SET recheck_private=1 WHERE sender_key=? AND (state IN ('sending','sending_approved','uncertain','rate_limit_review') OR (state='digest_batched' AND attempt_id IN (SELECT d.attempt_id FROM inbox_digest_items d JOIN inbox_digest_batches b ON b.id=d.batch_id WHERE b.state IN ('sending','uncertain','rate_limit_review'))))").run(key);
    }
   }
   this.db.exec('COMMIT');return changed;
  } catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 digestBatches(now=Date.now()) {return this.db.prepare("SELECT * FROM inbox_digest_batches WHERE state='pending' AND NOT EXISTS (SELECT 1 FROM inbox_delivery_retry r WHERE r.kind='digest' AND r.id=inbox_digest_batches.id AND r.retry_at>?) ORDER BY rowid LIMIT 20").all(now);}
 claimDigest(id:string,revision:number,now:number,deliveryNow=Date.now()) {
  this.db.exec('BEGIN IMMEDIATE');try {
   const settings=this.settings();if(!settings?.enabled || settings.revision!==revision || now<settings.nextDigestAt){this.db.exec('COMMIT');return;}
   const rows=this.db.prepare("SELECT attempt_id,summary FROM inbox_monitor_items WHERE state='digest_pending' AND settings_revision=? AND NOT EXISTS (SELECT 1 FROM inbox_delivery_retry r WHERE r.kind='item' AND r.id=attempt_id AND r.retry_at>?) ORDER BY rowid LIMIT 10").all(revision,deliveryNow);
   if(!rows.length){this.db.prepare('UPDATE inbox_monitor_settings SET next_digest_at=? WHERE id=1 AND revision=?').run(now+settings.digestMinutes*60000,revision);this.db.exec('COMMIT');return;}
   const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
   const text=`Gmail digest:\n${rows.map((row,index)=>`${index+1}. ${escape(String(row.summary))}`).join('\n')}\nGmail history does not establish whether these messages were in the inbox when they arrived.`;
   this.db.prepare("INSERT INTO inbox_digest_batches VALUES (?,?,'pending',?,NULL,?)").run(id,revision,text,now);
   for(const row of rows){this.db.prepare('INSERT INTO inbox_digest_items VALUES (?,?)').run(id,String(row.attempt_id));this.db.prepare("UPDATE inbox_monitor_items SET state='digest_batched' WHERE attempt_id=? AND state='digest_pending'").run(String(row.attempt_id));}
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 setBatchState(id:string,from:string,to:string) {return this.db.prepare('UPDATE inbox_digest_batches SET state=? WHERE id=? AND state=?').run(to,id,from).changes===1;}
 finishDigest(id:string,ts:string|null) {this.db.exec('BEGIN IMMEDIATE');try {const changed=this.db.prepare("UPDATE inbox_digest_batches SET state='delivered',thread_ts=? WHERE id=? AND state='sending'").run(ts,id);if(changed.changes)this.db.prepare("UPDATE inbox_monitor_items SET state='delivered',delivery_ts=? WHERE attempt_id IN (SELECT attempt_id FROM inbox_digest_items WHERE batch_id=?) AND state='digest_batched'").run(ts,id);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}}
 uncertainItem(id:string) {return this.db.prepare("SELECT * FROM inbox_monitor_items WHERE attempt_id=? AND state IN ('uncertain','rate_limit_review')").get(id);}
 uncertainDigest(id:string) {return this.db.prepare("SELECT * FROM inbox_digest_batches WHERE id=? AND state IN ('uncertain','rate_limit_review')").get(id);}
 resolveItem(id:string,decision:'sent'|'dismiss'|'resend') {
  const row=this.uncertainItem(id);if(!row)throw Error('Delivery is no longer uncertain');
  const from=String(row.uncertain_from);if(row.state==='rate_limit_review' && decision!=='dismiss')throw Error('Slack retry delay requires review; dismiss without sending');if(decision==='resend' && (row.recheck_private===1 || (from==='sending' && this.hasSensitiveFeedback(id))))throw Error('Privacy changed; this delivery cannot be resent');if(decision==='sent' && from==='sending_clarification')throw Error('A clarification cannot be bound to its thread without a confirmed Slack timestamp');
  if(decision!=='dismiss' && !['sending','sending_approved','sending_clarification'].includes(from))throw Error('The original delivery type is unknown; dismiss this record without resending');
  const next=decision==='sent'?'delivered':decision==='dismiss'?'dismissed':from==='sending_clarification'?'clarify':from==='sending_approved'?'approved':from==='sending'?'ready':null;
  if(!next || !this.setState(id,String(row.state),next))throw Error('Delivery is no longer uncertain');
 }
 resolveDigest(id:string,decision:'sent'|'dismiss'|'resend') {
  this.db.exec('BEGIN IMMEDIATE');try {
   const next=decision==='sent'?'delivered':decision==='dismiss'?'dismissed':'pending';
   const row=this.uncertainDigest(id);if(!row || (row.state==='rate_limit_review' && decision!=='dismiss'))throw Error('Digest retry delay requires review; dismiss without sending');
   if(decision==='resend' && this.db.prepare("SELECT 1 FROM inbox_monitor_items WHERE recheck_private=1 AND attempt_id IN (SELECT attempt_id FROM inbox_digest_items WHERE batch_id=?)").get(id))throw Error('Privacy changed; this digest cannot be resent');
   if(!this.setBatchState(id,String(row.state),next))throw Error('Delivery is no longer uncertain');
   if(decision!=='resend')this.db.prepare('UPDATE inbox_monitor_items SET state=? WHERE attempt_id IN (SELECT attempt_id FROM inbox_digest_items WHERE batch_id=?) AND state=\'digest_batched\'').run(decision==='sent'?'delivered':'dismissed',id);
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
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
