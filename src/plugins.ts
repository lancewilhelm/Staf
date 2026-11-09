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
}];
export const slackConfigSchema=z.strictObject({teamId:z.string().regex(/^T[A-Z0-9]+$/),userId:z.string().regex(/^U[A-Z0-9]+$/),channelId:z.string().regex(/^D[A-Z0-9]+$/),botId:z.string().regex(/^[\w-]+$/)});
export type SlackConfig=z.infer<typeof slackConfigSchema>;
export const pluginSchema=`
CREATE TABLE IF NOT EXISTS plugin_connections (plugin_id TEXT NOT NULL, account_id TEXT NOT NULL, config TEXT NOT NULL, connected INTEGER NOT NULL, enabled INTEGER NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(plugin_id,account_id));
CREATE TABLE IF NOT EXISTS plugin_agent_access (plugin_id TEXT NOT NULL, account_id TEXT NOT NULL, bot_id TEXT NOT NULL REFERENCES bots(id), enabled INTEGER NOT NULL, PRIMARY KEY(plugin_id,account_id,bot_id));
CREATE TABLE IF NOT EXISTS plugin_events (plugin_id TEXT NOT NULL, account_id TEXT NOT NULL, event_id TEXT NOT NULL, command_id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, state TEXT NOT NULL, detail TEXT, PRIMARY KEY(plugin_id,account_id,event_id));`;

export const slackWorkSchema=`
CREATE TABLE IF NOT EXISTS slack_work (attempt_id TEXT PRIMARY KEY REFERENCES task_attempts(id), team_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL, thread_ts TEXT, bot_id TEXT NOT NULL REFERENCES bots(id));
CREATE TABLE IF NOT EXISTS slack_deliveries (id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES slack_work(attempt_id), text TEXT NOT NULL, state TEXT NOT NULL, retry_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS slack_notices (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL, thread_ts TEXT, bot_id TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL, retry_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS slack_deliveries_pending ON slack_deliveries(state,retry_at);`;

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
 isPluginCommand(commandId:string) {return !!this.db.prepare('SELECT 1 FROM plugin_events WHERE command_id=?').get(commandId);}
 state(commandId:string,state:'sending'|'sent'|'failed'|'uncertain'|'interrupted'|'task',detail:string|null=null) {this.db.prepare('UPDATE plugin_events SET state=?,detail=? WHERE command_id=?').run(state,detail,commandId);}
 events() {return this.db.prepare("SELECT event_id AS eventId,command_id AS commandId,state,detail FROM plugin_events WHERE plugin_id='slack' ORDER BY rowid DESC LIMIT 30").all();}
 work() {return this.db.prepare("SELECT w.* FROM slack_work w JOIN task_attempts a ON a.id=w.attempt_id WHERE a.state IN ('queued','running','stopping','waiting') OR NOT EXISTS (SELECT 1 FROM slack_deliveries d WHERE d.id=w.attempt_id||':outcome') ORDER BY w.rowid").all();}
 workBinding(id:string) {return this.db.prepare('SELECT * FROM slack_work WHERE attempt_id=?').get(id);}
 threadWork(config:SlackConfig,threadTs:string) {return this.db.prepare('SELECT attempt_id FROM slack_work WHERE team_id=? AND user_id=? AND channel_id=? AND bot_id=? AND thread_ts=? ORDER BY rowid').all(config.teamId,config.userId,config.channelId,config.botId,threadTs).map(row=>String(row.attempt_id));}
 deliveries() {return this.db.prepare("SELECT attemptId,id,state FROM (SELECT attempt_id AS attemptId,id,state,rowid AS ordering FROM slack_deliveries UNION ALL SELECT NULL AS attemptId,id,state,rowid AS ordering FROM slack_notices) ORDER BY ordering DESC LIMIT 30").all();}
 queueNotice(input:{id:string;config:SlackConfig;threadTs?:string;text:string}) {this.db.prepare("INSERT OR IGNORE INTO slack_notices VALUES (?,?,?,?,?,?,?,'pending',0)").run(input.id,input.config.teamId,input.config.userId,input.config.channelId,input.threadTs ?? null,input.config.botId,input.text);}
 queueWork(id:string,key:string,text:string) {this.db.prepare("INSERT OR IGNORE INTO slack_deliveries (id,attempt_id,text,state) VALUES (?,?,?,'pending')").run(key,id,text);}
 pendingWork(now:number) {return this.db.prepare(`SELECT 'work' AS kind,d.id,d.text,w.team_id,w.user_id,w.channel_id,w.thread_ts,w.bot_id FROM slack_deliveries d JOIN slack_work w ON w.attempt_id=d.attempt_id WHERE d.state='pending' AND d.retry_at<=? AND NOT EXISTS (SELECT 1 FROM slack_deliveries prior WHERE prior.attempt_id=d.attempt_id AND prior.state IN ('pending','sending') AND prior.rowid<d.rowid) UNION ALL SELECT 'notice' AS kind,id,text,team_id,user_id,channel_id,thread_ts,bot_id FROM slack_notices WHERE state='pending' AND retry_at<=? LIMIT 20`).all(now,now);}
 beginWorkDelivery(id:string,kind:'work'|'notice') {const table=kind==='work'?'slack_deliveries':'slack_notices';return this.db.prepare(`UPDATE ${table} SET state='sending' WHERE id=? AND state='pending'`).run(id).changes===1;}
 finishWorkDelivery(id:string,kind:'work'|'notice',state:'sent'|'uncertain'|'pending',retryAt=0) {const table=kind==='work'?'slack_deliveries':'slack_notices';this.db.prepare(`UPDATE ${table} SET state=?,retry_at=? WHERE id=? AND state='sending'`).run(state,retryAt,id);}
}
