import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';

/** A bundled plugin can offer any combination of tools and background events. */
export interface PluginDefinition {
  id: string;
  name: string;
  description: string;
  configuration: readonly {name:string; secret:boolean; description:string}[];
  lifecycle: readonly ('connect'|'enable'|'disable'|'disconnect'|'delete-config')[];
  tools: readonly string[];
  events: readonly string[];
  accountIdentity: string;
}
export const bundledPlugins: readonly PluginDefinition[] = [{
  id:'slack', name:'Slack', description:'Chat with an agent in an approved Slack direct message.',
  configuration:[{name:'appToken',secret:true,description:'Socket Mode app token'}, {name:'botToken',secret:true,description:'Bot user token'}, {name:'teamId',secret:false,description:'Workspace ID'}, {name:'userId',secret:false,description:'Approved user ID'}, {name:'channelId',secret:false,description:'Direct message channel ID'}, {name:'botId',secret:false,description:'Staf agent ID'}],
  lifecycle:['connect','enable','disable','disconnect','delete-config'],tools:[],events:['direct_message'],accountIdentity:'Slack workspace ID',
},{
  id:'gmail',name:'Gmail',description:'Search Gmail and inspect new message candidates.',
  configuration:[{name:'email',secret:false,description:'Google account email'},{name:'clientId',secret:false,description:'Google desktop OAuth client ID'},{name:'clientSecret',secret:true,description:'Google desktop OAuth client secret'}],
  lifecycle:['connect','enable','disable','disconnect','delete-config'],tools:['gmail_search','gmail_read','gmail_reply','gmail_modify'],events:['message_candidate'],accountIdentity:'Gmail address',
}];
export const slackConfigSchema=z.strictObject({teamId:z.string().regex(/^T[A-Z0-9]+$/),userId:z.string().regex(/^U[A-Z0-9]+$/),channelId:z.string().regex(/^D[A-Z0-9]+$/),botId:z.string().regex(/^[\w-]+$/)});
export type SlackConfig=z.infer<typeof slackConfigSchema>;
export const gmailConfigSchema=z.strictObject({email:z.email().max(320),clientId:z.string().min(1).max(500)});
export type GmailConfig=z.infer<typeof gmailConfigSchema>;
export const pluginSchema=`
CREATE TABLE IF NOT EXISTS plugin_connections (plugin_id TEXT NOT NULL, account_id TEXT NOT NULL, config TEXT NOT NULL, connected INTEGER NOT NULL, enabled INTEGER NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(plugin_id,account_id));
CREATE TABLE IF NOT EXISTS plugin_agent_access (plugin_id TEXT NOT NULL, account_id TEXT NOT NULL, bot_id TEXT NOT NULL REFERENCES bots(id), enabled INTEGER NOT NULL, PRIMARY KEY(plugin_id,account_id,bot_id));
CREATE TABLE IF NOT EXISTS plugin_events (plugin_id TEXT NOT NULL, account_id TEXT NOT NULL, event_id TEXT NOT NULL, command_id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, state TEXT NOT NULL, detail TEXT, PRIMARY KEY(plugin_id,account_id,event_id));`;

export const slackWorkSchema=`
CREATE TABLE IF NOT EXISTS slack_work (attempt_id TEXT PRIMARY KEY REFERENCES task_attempts(id), team_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL, thread_ts TEXT, bot_id TEXT NOT NULL REFERENCES bots(id));
CREATE TABLE IF NOT EXISTS slack_deliveries (id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES slack_work(attempt_id), text TEXT NOT NULL, state TEXT NOT NULL, retry_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS slack_notices (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL, thread_ts TEXT, bot_id TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL, retry_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS slack_deliveries_pending ON slack_deliveries(state,retry_at);`;
export const slackOutcomeReviewSchema=`CREATE TABLE IF NOT EXISTS slack_outcome_reviews (
 id TEXT PRIMARY KEY REFERENCES slack_deliveries(id), attempt_id TEXT NOT NULL REFERENCES slack_work(attempt_id),
 slack_revision INTEGER NOT NULL, bot_revision TEXT NOT NULL
);`;

export class PluginStore {
 constructor(private readonly db:DatabaseSync) {
  db.exec("UPDATE plugin_events SET state=CASE WHEN state='sending' THEN 'uncertain' ELSE 'interrupted' END WHERE state IN ('accepted','sending')");
  db.exec("UPDATE slack_deliveries SET state='uncertain' WHERE state='sending'");
  db.exec("UPDATE slack_notices SET state='uncertain' WHERE state='sending'");
 }
 connection() {
  const row=this.db.prepare("SELECT account_id,config,connected,enabled,revision FROM plugin_connections WHERE plugin_id='slack' LIMIT 1").get();
  if(!row)return null;
  const config=slackConfigSchema.parse(JSON.parse(String(row.config)));
  return {accountId:String(row.account_id),config,connected:row.connected===1,enabled:row.enabled===1,revision:Number(row.revision),agentAccess:this.access(config.teamId,config.botId)};
 }
 access(accountId:string,botId:string) {return this.db.prepare("SELECT enabled FROM plugin_agent_access WHERE plugin_id='slack' AND account_id=? AND bot_id=?").get(accountId,botId)?.enabled===1;}
 connect(config:SlackConfig) {
  const existing=this.connection();if(existing && existing.accountId!==config.teamId)throw Error('Disconnect and delete the existing Slack configuration before changing workspace');
  this.db.prepare("INSERT INTO plugin_connections VALUES ('slack',?,?,1,0,1) ON CONFLICT(plugin_id,account_id) DO UPDATE SET config=excluded.config,connected=1,enabled=0,revision=plugin_connections.revision+1").run(config.teamId,JSON.stringify(config));
  return this.connection();
 }
 setEnabled(enabled:boolean) {const c=this.connection();if(!c || (enabled && !c.connected))throw Error('Connect Slack first');this.db.prepare("UPDATE plugin_connections SET enabled=?,revision=revision+1 WHERE plugin_id='slack' AND account_id=?").run(enabled?1:0,c.accountId);return this.connection();}
 setAccess(botId:string,enabled:boolean) {const c=this.connection();if(!c)throw Error('Configure Slack first');if(!this.db.prepare('SELECT 1 FROM bots WHERE id=?').get(botId))throw Error('Agent not found');this.db.prepare("INSERT INTO plugin_agent_access VALUES ('slack',?,?,?) ON CONFLICT(plugin_id,account_id,bot_id) DO UPDATE SET enabled=excluded.enabled").run(c.accountId,botId,enabled?1:0);this.db.prepare("UPDATE plugin_connections SET revision=revision+1 WHERE plugin_id='slack' AND account_id=?").run(c.accountId);return this.connection();}
 disconnect() {const c=this.connection();if(c)this.db.prepare("UPDATE plugin_connections SET connected=0,enabled=0,revision=revision+1 WHERE plugin_id='slack' AND account_id=?").run(c.accountId);return this.connection();}
 deleteConfig() {const c=this.connection();if(c){this.db.prepare("DELETE FROM plugin_agent_access WHERE plugin_id='slack' AND account_id=?").run(c.accountId);this.db.prepare("DELETE FROM plugin_connections WHERE plugin_id='slack' AND account_id=?").run(c.accountId);}return null;}
 reserve(eventId:string,commandId:string,revision:number) {const c=this.connection();if(!c || !c.enabled || !c.connected || !c.agentAccess || c.revision!==revision)return false;return this.db.prepare("INSERT OR IGNORE INTO plugin_events VALUES ('slack',?,?,?,?, 'accepted',NULL)").run(c.accountId,eventId,commandId,revision).changes===1;}
 authority(commandId:string) {const row=this.db.prepare("SELECT account_id,revision FROM plugin_events WHERE command_id=? AND state='accepted'").get(commandId);if(!row)return false;const c=this.connection();return !!c && c.accountId===row.account_id && c.revision===row.revision && c.enabled && c.connected && c.agentAccess;}
 currentAuthority(commandId:string) {const row=this.db.prepare('SELECT account_id,revision FROM plugin_events WHERE command_id=?').get(commandId);if(!row)return false;const c=this.connection();return !!c && c.accountId===row.account_id && c.revision===row.revision && c.enabled && c.connected && c.agentAccess;}
 isPluginCommand(commandId:string) {return !!this.db.prepare('SELECT 1 FROM plugin_events WHERE command_id=?').get(commandId);}
 state(commandId:string,state:'sending'|'sent'|'failed'|'uncertain'|'interrupted'|'task',detail:string|null=null) {this.db.prepare('UPDATE plugin_events SET state=?,detail=? WHERE command_id=?').run(state,detail,commandId);}
 events() {return this.db.prepare("SELECT event_id AS eventId,command_id AS commandId,state,detail FROM plugin_events WHERE plugin_id='slack' ORDER BY rowid DESC LIMIT 30").all();}
 gmailConnection() {
  const row=this.db.prepare("SELECT account_id,config,connected,enabled,revision FROM plugin_connections WHERE plugin_id='gmail' LIMIT 1").get();
  if(!row)return null;
  const config=gmailConfigSchema.parse(JSON.parse(String(row.config)));
  const agentAccessIds=this.db.prepare("SELECT bot_id FROM plugin_agent_access WHERE plugin_id='gmail' AND account_id=? AND enabled=1 ORDER BY bot_id").all(String(row.account_id)).map(item=>String(item.bot_id));
  return {accountId:String(row.account_id),config,connected:row.connected===1,enabled:row.enabled===1,revision:Number(row.revision),agentAccessIds};
 }
 gmailConnect(config:GmailConfig,historyId:string,guidedSetupId?:string) {
  const existing=this.gmailConnection();if(existing && existing.accountId!==config.email)throw Error('Delete the existing Gmail configuration before changing accounts');
  if(!/^\d+$/.test(historyId))throw Error('Invalid Gmail history ID');this.db.exec('SAVEPOINT gmail_connect');
  try {
   const baseline=this.db.prepare('SELECT 1 FROM gmail_history WHERE account_id=?').get(config.email);
   if(existing && !baseline)this.db.prepare('INSERT INTO gmail_history_gaps VALUES (?,NULL,?,?,?)').run(config.email,historyId,'Monitoring began after the account was connected',Date.now());
   this.db.prepare("INSERT OR IGNORE INTO gmail_history VALUES (?,?,'ready',NULL)").run(config.email,historyId);
   this.db.prepare("INSERT INTO plugin_connections VALUES ('gmail',?,?,1,0,1) ON CONFLICT(plugin_id,account_id) DO UPDATE SET config=excluded.config,connected=1,enabled=0,revision=plugin_connections.revision+1").run(config.email,JSON.stringify(config));
   if(guidedSetupId && !this.db.prepare("UPDATE gmail_setup_requests SET state='connected' WHERE question_id=? AND state='authorizing'").run(guidedSetupId).changes)throw Error('Gmail setup authority changed');
   this.db.exec('RELEASE SAVEPOINT gmail_connect');
  }catch(error){this.db.exec('ROLLBACK TO SAVEPOINT gmail_connect; RELEASE SAVEPOINT gmail_connect');throw error;}
  return this.gmailConnection();
 }
 gmailSetEnabled(enabled:boolean) {const c=this.gmailConnection();if(!c || (enabled && !c.connected))throw Error('Connect Gmail first');this.db.prepare("UPDATE plugin_connections SET enabled=?,revision=revision+1 WHERE plugin_id='gmail' AND account_id=?").run(enabled?1:0,c.accountId);return this.gmailConnection();}
 gmailSetAccess(botId:string,enabled:boolean) {const c=this.gmailConnection();if(!c)throw Error('Configure Gmail first');if(!this.db.prepare('SELECT 1 FROM bots WHERE id=?').get(botId))throw Error('Agent not found');this.db.prepare("INSERT INTO plugin_agent_access VALUES ('gmail',?,?,?) ON CONFLICT(plugin_id,account_id,bot_id) DO UPDATE SET enabled=excluded.enabled").run(c.accountId,botId,enabled?1:0);this.db.prepare("UPDATE plugin_connections SET revision=revision+1 WHERE plugin_id='gmail' AND account_id=?").run(c.accountId);return this.gmailConnection();}
 gmailModelAccess() {const c=this.gmailConnection();if(!c)return [];return this.db.prepare('SELECT bot_id AS botId,provider,model FROM gmail_model_access WHERE account_id=? ORDER BY bot_id').all(c.accountId);}
 gmailModelAllowed(accountId:string,botId:string,provider:string,model:string) {return !!this.db.prepare('SELECT 1 FROM gmail_model_access WHERE account_id=? AND bot_id=? AND provider=? AND model=?').get(accountId,botId,provider,model);}
 gmailWorkModelAccess() {const c=this.gmailConnection();if(!c)return [];return this.db.prepare('SELECT bot_id AS botId,provider,model FROM gmail_work_model_access WHERE account_id=? ORDER BY bot_id').all(c.accountId);}
 gmailWorkModelAllowed(accountId:string,botId:string,provider:string,model:string) {return !!this.db.prepare('SELECT 1 FROM gmail_work_model_access WHERE account_id=? AND bot_id=? AND provider=? AND model=?').get(accountId,botId,provider,model);}
 gmailSetWorkModelAccess(botId:string,provider:string,model:string,enabled:boolean) {const c=this.gmailConnection();if(!c)throw Error('Configure Gmail first');if(enabled)this.db.prepare('INSERT INTO gmail_work_model_access VALUES (?,?,?,?) ON CONFLICT(account_id,bot_id) DO UPDATE SET provider=excluded.provider,model=excluded.model').run(c.accountId,botId,provider,model);else this.db.prepare('DELETE FROM gmail_work_model_access WHERE account_id=? AND bot_id=?').run(c.accountId,botId);this.db.prepare("UPDATE plugin_connections SET revision=revision+1 WHERE plugin_id='gmail' AND account_id=?").run(c.accountId);}
 gmailSetModelAccess(botId:string,provider:string,model:string,enabled:boolean) {const c=this.gmailConnection();if(!c)throw Error('Configure Gmail first');this.db.prepare('DELETE FROM gmail_work_model_access WHERE account_id=? AND bot_id=?').run(c.accountId,botId);if(enabled)this.db.prepare('INSERT INTO gmail_model_access VALUES (?,?,?,?) ON CONFLICT(account_id,bot_id) DO UPDATE SET provider=excluded.provider,model=excluded.model').run(c.accountId,botId,provider,model);else this.db.prepare('DELETE FROM gmail_model_access WHERE account_id=? AND bot_id=?').run(c.accountId,botId);this.db.prepare("UPDATE plugin_connections SET revision=revision+1 WHERE plugin_id='gmail' AND account_id=?").run(c.accountId);}
 gmailDisconnect() {const c=this.gmailConnection();if(c)this.db.prepare("UPDATE plugin_connections SET connected=0,enabled=0,revision=revision+1 WHERE plugin_id='gmail' AND account_id=?").run(c.accountId);return this.gmailConnection();}
 gmailDeleteConfig() {const c=this.gmailConnection();if(c){this.db.prepare('DELETE FROM gmail_work_model_access WHERE account_id=?').run(c.accountId);this.db.prepare('DELETE FROM gmail_model_access WHERE account_id=?').run(c.accountId);this.db.prepare("DELETE FROM plugin_agent_access WHERE plugin_id='gmail' AND account_id=?").run(c.accountId);this.db.prepare("DELETE FROM plugin_connections WHERE plugin_id='gmail' AND account_id=?").run(c.accountId);}return null;}
 work() {return this.db.prepare("SELECT w.* FROM slack_work w JOIN task_attempts a ON a.id=w.attempt_id WHERE a.state IN ('queued','running','stopping','waiting') OR NOT EXISTS (SELECT 1 FROM slack_deliveries d WHERE d.id=w.attempt_id||':outcome') ORDER BY w.rowid").all();}
 workBinding(id:string) {return this.db.prepare('SELECT * FROM slack_work WHERE attempt_id=?').get(id);}
 outcomeReview(id:string) {return this.db.prepare(`SELECT r.id,r.slack_revision AS slackRevision,r.bot_revision AS botRevision,d.state,d.text FROM slack_outcome_reviews r JOIN slack_deliveries d ON d.id=r.id WHERE r.attempt_id=? ORDER BY r.rowid DESC LIMIT 1`).get(id);}
 outcomeApproval(id:string) {return this.db.prepare('SELECT slack_revision AS slackRevision,bot_revision AS botRevision FROM slack_outcome_reviews WHERE id=?').get(id);}
 blockOutcome(id:string) {this.db.prepare("UPDATE slack_deliveries SET state='blocked' WHERE id=? AND state='pending'").run(id);}
 approveOutcome(input:{id:string;attemptId:string;text:string;slackRevision:number;botRevision:string}) {
  this.db.exec('BEGIN IMMEDIATE');
  try {
   const existing=this.db.prepare('SELECT d.text,r.slack_revision,r.bot_revision FROM slack_outcome_reviews r JOIN slack_deliveries d ON d.id=r.id WHERE r.id=? AND r.attempt_id=?').get(input.id,input.attemptId);
   if(existing) {if(existing.text!==input.text || existing.slack_revision!==input.slackRevision || existing.bot_revision!==input.botRevision)throw Error('Disclosure identity conflict');this.db.exec('COMMIT');return;}
   const prior=this.outcomeReview(input.attemptId);
   if(prior && prior.state!=='blocked')throw Error('An outcome disclosure is already recorded');
   this.db.prepare("INSERT INTO slack_deliveries (id,attempt_id,text,state) VALUES (?,?,?,'pending')").run(input.id,input.attemptId,input.text);
   this.db.prepare('INSERT INTO slack_outcome_reviews VALUES (?,?,?,?)').run(input.id,input.attemptId,input.slackRevision,input.botRevision);
   this.db.exec('COMMIT');
  } catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 threadWork(config:SlackConfig,threadTs:string) {return this.db.prepare('SELECT attempt_id FROM slack_work WHERE team_id=? AND user_id=? AND channel_id=? AND bot_id=? AND thread_ts=? ORDER BY rowid').all(config.teamId,config.userId,config.channelId,config.botId,threadTs).map(row=>String(row.attempt_id));}
 deliveries() {return this.db.prepare("SELECT attemptId,id,state FROM (SELECT attempt_id AS attemptId,id,state,rowid AS ordering FROM slack_deliveries UNION ALL SELECT NULL AS attemptId,id,state,rowid AS ordering FROM slack_notices) ORDER BY ordering DESC LIMIT 30").all();}
 queueNotice(input:{id:string;config:SlackConfig;threadTs?:string;text:string}) {this.db.prepare("INSERT OR IGNORE INTO slack_notices VALUES (?,?,?,?,?,?,?,'pending',0)").run(input.id,input.config.teamId,input.config.userId,input.config.channelId,input.threadTs ?? null,input.config.botId,input.text);}
 queueWork(id:string,key:string,text:string) {this.db.prepare("INSERT OR IGNORE INTO slack_deliveries (id,attempt_id,text,state) VALUES (?,?,?,'pending')").run(key,id,text);}
 pendingWork(now:number) {return this.db.prepare(`SELECT 'work' AS kind,d.id,d.text,d.attempt_id,w.team_id,w.user_id,w.channel_id,w.thread_ts,w.bot_id FROM slack_deliveries d JOIN slack_work w ON w.attempt_id=d.attempt_id WHERE d.state='pending' AND d.retry_at<=? AND NOT EXISTS (SELECT 1 FROM slack_deliveries prior WHERE prior.attempt_id=d.attempt_id AND prior.state IN ('pending','sending') AND prior.rowid<d.rowid) UNION ALL SELECT 'notice' AS kind,id,text,NULL AS attempt_id,team_id,user_id,channel_id,thread_ts,bot_id FROM slack_notices WHERE state='pending' AND retry_at<=? LIMIT 20`).all(now,now);}
 beginWorkDelivery(id:string,kind:'work'|'notice') {const table=kind==='work'?'slack_deliveries':'slack_notices';return this.db.prepare(`UPDATE ${table} SET state='sending' WHERE id=? AND state='pending'`).run(id).changes===1;}
 finishWorkDelivery(id:string,kind:'work'|'notice',state:'sent'|'uncertain'|'pending',retryAt=0) {const table=kind==='work'?'slack_deliveries':'slack_notices';this.db.prepare(`UPDATE ${table} SET state=?,retry_at=? WHERE id=? AND state='sending'`).run(state,retryAt,id);}
}
