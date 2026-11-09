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
  id:'gmail',name:'Gmail',description:'Connect an account for future Gmail capabilities.',
  configuration:[{name:'email',secret:false,description:'Google account email'},{name:'clientId',secret:false,description:'Google desktop OAuth client ID'},{name:'clientSecret',secret:true,description:'Google desktop OAuth client secret'}],
  lifecycle:['connect','enable','disable','disconnect','delete-config'],tools:[],events:[],accountIdentity:'Gmail address',
}];
export const slackConfigSchema=z.strictObject({teamId:z.string().regex(/^T[A-Z0-9]+$/),userId:z.string().regex(/^U[A-Z0-9]+$/),channelId:z.string().regex(/^D[A-Z0-9]+$/),botId:z.string().regex(/^[\w-]+$/)});
export type SlackConfig=z.infer<typeof slackConfigSchema>;
export const gmailConfigSchema=z.strictObject({email:z.email().max(320),clientId:z.string().min(1).max(500)});
export type GmailConfig=z.infer<typeof gmailConfigSchema>;
export const pluginSchema=`
CREATE TABLE IF NOT EXISTS plugin_connections (plugin_id TEXT NOT NULL, account_id TEXT NOT NULL, config TEXT NOT NULL, connected INTEGER NOT NULL, enabled INTEGER NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(plugin_id,account_id));
CREATE TABLE IF NOT EXISTS plugin_agent_access (plugin_id TEXT NOT NULL, account_id TEXT NOT NULL, bot_id TEXT NOT NULL REFERENCES bots(id), enabled INTEGER NOT NULL, PRIMARY KEY(plugin_id,account_id,bot_id));
CREATE TABLE IF NOT EXISTS plugin_events (plugin_id TEXT NOT NULL, account_id TEXT NOT NULL, event_id TEXT NOT NULL, command_id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, state TEXT NOT NULL, detail TEXT, PRIMARY KEY(plugin_id,account_id,event_id));`;

export class PluginStore {
 constructor(private readonly db:DatabaseSync) {
  db.exec("UPDATE plugin_events SET state=CASE WHEN state='sending' THEN 'uncertain' ELSE 'interrupted' END WHERE state IN ('accepted','sending')");
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
 state(commandId:string,state:'sending'|'sent'|'failed'|'uncertain'|'interrupted',detail:string|null=null) {this.db.prepare('UPDATE plugin_events SET state=?,detail=? WHERE command_id=?').run(state,detail,commandId);}
 events() {return this.db.prepare("SELECT event_id AS eventId,command_id AS commandId,state,detail FROM plugin_events WHERE plugin_id='slack' ORDER BY rowid DESC LIMIT 30").all();}
 gmailConnection() {
  const row=this.db.prepare("SELECT account_id,config,connected,enabled,revision FROM plugin_connections WHERE plugin_id='gmail' LIMIT 1").get();
  if(!row)return null;
  const config=gmailConfigSchema.parse(JSON.parse(String(row.config)));
  const agentAccessIds=this.db.prepare("SELECT bot_id FROM plugin_agent_access WHERE plugin_id='gmail' AND account_id=? AND enabled=1 ORDER BY bot_id").all(String(row.account_id)).map(item=>String(item.bot_id));
  return {accountId:String(row.account_id),config,connected:row.connected===1,enabled:row.enabled===1,revision:Number(row.revision),agentAccessIds};
 }
 gmailConnect(config:GmailConfig) {
  const existing=this.gmailConnection();if(existing && existing.accountId!==config.email)throw Error('Delete the existing Gmail configuration before changing accounts');
  this.db.prepare("INSERT INTO plugin_connections VALUES ('gmail',?,?,1,0,1) ON CONFLICT(plugin_id,account_id) DO UPDATE SET config=excluded.config,connected=1,enabled=0,revision=plugin_connections.revision+1").run(config.email,JSON.stringify(config));
  return this.gmailConnection();
 }
 gmailSetEnabled(enabled:boolean) {const c=this.gmailConnection();if(!c || (enabled && !c.connected))throw Error('Connect Gmail first');this.db.prepare("UPDATE plugin_connections SET enabled=?,revision=revision+1 WHERE plugin_id='gmail' AND account_id=?").run(enabled?1:0,c.accountId);return this.gmailConnection();}
 gmailSetAccess(botId:string,enabled:boolean) {const c=this.gmailConnection();if(!c)throw Error('Configure Gmail first');if(!this.db.prepare('SELECT 1 FROM bots WHERE id=?').get(botId))throw Error('Agent not found');this.db.prepare("INSERT INTO plugin_agent_access VALUES ('gmail',?,?,?) ON CONFLICT(plugin_id,account_id,bot_id) DO UPDATE SET enabled=excluded.enabled").run(c.accountId,botId,enabled?1:0);this.db.prepare("UPDATE plugin_connections SET revision=revision+1 WHERE plugin_id='gmail' AND account_id=?").run(c.accountId);return this.gmailConnection();}
 gmailDisconnect() {const c=this.gmailConnection();if(c)this.db.prepare("UPDATE plugin_connections SET connected=0,enabled=0,revision=revision+1 WHERE plugin_id='gmail' AND account_id=?").run(c.accountId);return this.gmailConnection();}
 gmailDeleteConfig() {const c=this.gmailConnection();if(c){this.db.prepare("DELETE FROM plugin_agent_access WHERE plugin_id='gmail' AND account_id=?").run(c.accountId);this.db.prepare("DELETE FROM plugin_connections WHERE plugin_id='gmail' AND account_id=?").run(c.accountId);}return null;}
}
