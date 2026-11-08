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
CREATE TABLE plugin_connections (plugin_id TEXT NOT NULL, account_id TEXT NOT NULL, config TEXT NOT NULL, connected INTEGER NOT NULL, enabled INTEGER NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(plugin_id,account_id));
CREATE TABLE plugin_agent_access (plugin_id TEXT NOT NULL, account_id TEXT NOT NULL, bot_id TEXT NOT NULL REFERENCES bots(id), enabled INTEGER NOT NULL, PRIMARY KEY(plugin_id,account_id,bot_id));
CREATE TABLE plugin_events (plugin_id TEXT NOT NULL, account_id TEXT NOT NULL, event_id TEXT NOT NULL, command_id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, state TEXT NOT NULL, detail TEXT, PRIMARY KEY(plugin_id,account_id,event_id));`;

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
}
