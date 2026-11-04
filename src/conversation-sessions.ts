import type { DatabaseSync } from 'node:sqlite';

// Slot 31. Replay remains private; messages and commands keep their original rows.
export const conversationSessionSchema = `
CREATE TABLE IF NOT EXISTS conversation_sessions (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), name TEXT NOT NULL, created_at INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)), replay TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_conversation ON conversation_sessions(bot_id) WHERE active=1;
CREATE TABLE IF NOT EXISTS conversation_message_sessions (message_id TEXT PRIMARY KEY REFERENCES messages(id), session_id TEXT NOT NULL REFERENCES conversation_sessions(id));
CREATE TABLE IF NOT EXISTS conversation_command_sessions (command_id TEXT PRIMARY KEY REFERENCES commands(id), session_id TEXT NOT NULL REFERENCES conversation_sessions(id));
CREATE TABLE IF NOT EXISTS conversation_session_operations (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), expected_session_id TEXT NOT NULL, name TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES conversation_sessions(id));
INSERT OR IGNORE INTO conversation_sessions(id,bot_id,name,created_at,active) SELECT chat_id,id,'Initial session',0,1 FROM bots;
INSERT OR IGNORE INTO conversation_message_sessions SELECT m.id,s.id FROM messages m JOIN conversation_sessions s ON s.bot_id=m.bot_id AND s.active=1;
INSERT OR IGNORE INTO conversation_command_sessions SELECT c.id,s.id FROM commands c JOIN conversation_sessions s ON s.bot_id=c.bot_id AND s.active=1;
CREATE TRIGGER IF NOT EXISTS conversation_new_bot AFTER INSERT ON bots BEGIN INSERT INTO conversation_sessions VALUES (NEW.chat_id,NEW.id,'Initial session',0,1,NULL); END;
CREATE TRIGGER IF NOT EXISTS conversation_new_message AFTER INSERT ON messages BEGIN INSERT INTO conversation_message_sessions SELECT NEW.id,id FROM conversation_sessions WHERE bot_id=NEW.bot_id AND active=1; END;
CREATE TRIGGER IF NOT EXISTS conversation_new_command AFTER INSERT ON commands BEGIN INSERT INTO conversation_command_sessions SELECT NEW.id,id FROM conversation_sessions WHERE bot_id=NEW.bot_id AND active=1; END;
`;

export type ConversationSession = {id:string;name:string;createdAt:number;active:number};
export type SessionHistoryMessage = {id:string;role:string;content:string};
export type SessionSearchResult = {sessionId:string;messageId:string;role:string;content:string};
export type SessionMessageReference = {kind:'session-message';sessionId:string;messageId:string};
export class ConversationSessions {
 constructor(private readonly db:DatabaseSync) {}
 current(botId:string) {
  const row=this.db.prepare('SELECT id,name,created_at AS createdAt FROM conversation_sessions WHERE bot_id=? AND active=1').get(botId);
  if(!row || typeof row.id!=='string' || typeof row.name!=='string' || typeof row.createdAt!=='number')throw Error('Agent not found');
  return {id:row.id,name:row.name,createdAt:row.createdAt};
 }
 list(botId:string,offset=0,limit=100) {
  this.current(botId);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('Invalid session page');
  return this.db.prepare('SELECT id,name,created_at AS createdAt,active FROM conversation_sessions WHERE bot_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?').all(botId,limit,offset).map(row=>({id:String(row.id),name:String(row.name),createdAt:Number(row.createdAt),active:Number(row.active)} satisfies ConversationSession));
 }
 read(botId:string,sessionId:string,offset=0,limit=100) {
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('Invalid history page');
  const session=this.db.prepare('SELECT id,name,created_at AS createdAt,active FROM conversation_sessions WHERE bot_id=? AND id=?').get(botId,sessionId);
  if(!session)throw Error('Session not found');
  const messages=this.db.prepare('SELECT m.id,m.role,m.content FROM messages m JOIN conversation_message_sessions x ON x.message_id=m.id WHERE m.bot_id=? AND x.session_id=? ORDER BY m.seq LIMIT ? OFFSET ?').all(botId,sessionId,limit,offset);
  return {session:{id:String(session.id),name:String(session.name),createdAt:Number(session.createdAt),active:Number(session.active)} satisfies ConversationSession,messages:messages.map(row=>({id:String(row.id),role:String(row.role),content:String(row.content)} satisfies SessionHistoryMessage))};
 }
 search(botId:string,query:string) {
  this.current(botId);if(!query.trim()||query.length>200)throw Error('Search must contain 1 to 200 characters');
  return this.db.prepare('SELECT s.id AS sessionId,m.id AS messageId,m.role,substr(m.content,1,1000) AS content FROM messages m JOIN conversation_message_sessions x ON x.message_id=m.id JOIN conversation_sessions s ON s.id=x.session_id WHERE m.bot_id=? AND s.bot_id=? AND instr(lower(m.content),lower(?))>0 ORDER BY m.seq DESC LIMIT 100').all(botId,botId,query).map(row=>({sessionId:String(row.sessionId),messageId:String(row.messageId),role:String(row.role),content:String(row.content)} satisfies SessionSearchResult));
 }
 resolve(botId:string,ref:SessionMessageReference) {
  const row=this.db.prepare('SELECT m.id AS messageId,s.id AS sessionId,m.role,substr(m.content,1,4000) AS content FROM messages m JOIN conversation_message_sessions x ON x.message_id=m.id JOIN conversation_sessions s ON s.id=x.session_id WHERE s.bot_id=? AND m.bot_id=? AND s.id=? AND m.id=?').get(botId,botId,ref.sessionId,ref.messageId);
  if(!row || typeof row.content!=='string' || typeof row.role!=='string')throw Error('Session message not found');
  return {kind:'session-message' as const,sessionId:ref.sessionId,messageId:ref.messageId,role:row.role,content:row.content};
 }
}
