import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Instance,INSTANCE_SCHEMA_VERSION} from '../dist/instance.js';

test('both schema 43 predecessors keep their Gmail and sensitive-memory state',()=>{
 for(const predecessor of ['gmail','memory']){
  const dir=mkdtempSync(join(tmpdir(),'staf-gmail-memory-migration-')),path=join(dir,'db');let instance;
  try {
   instance=new Instance(path);const bot=instance.createBot({name:'Preserved',instructions:'',provider:'live',model:'fixture'});instance.close();instance=undefined;
   let db=new DatabaseSync(path);
   db.prepare("INSERT INTO plugin_connections VALUES ('gmail','owner@example.test',?,1,0,1)").run(JSON.stringify({email:'owner@example.test',clientId:'fixture'}));
   db.prepare("INSERT INTO gmail_history VALUES ('owner@example.test','17','ready',NULL)").run();
   db.prepare("INSERT INTO gmail_arrivals VALUES ('owner@example.test','retained')").run();
   db.prepare("UPDATE memory_sensitivity SET revision=2,mode='review-all',terms=? WHERE id=1").run('["private topic"]');
   db.prepare("INSERT INTO sensitive_memory_proposals VALUES (?,?, 'command','work','bot','create',NULL,NULL,'pending detail','fingerprint','pending')").run('proposal',bot.id);
   if(predecessor==='gmail')db.exec('DROP TABLE sensitive_memory_proposals; DROP TABLE memory_sensitivity');
   else db.exec('DROP TABLE gmail_history; DROP TABLE gmail_arrivals; DROP TABLE gmail_history_gaps; DROP TABLE gmail_model_access; DROP TABLE gmail_private_commands; DROP TABLE gmail_private_messages');
   db.exec('PRAGMA user_version=43');db.close();
   instance=new Instance(path);assert.ok(instance.migrationBackup);instance.close();instance=undefined;
   db=new DatabaseSync(path,{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,INSTANCE_SCHEMA_VERSION);assert.equal(INSTANCE_SCHEMA_VERSION,45);
   assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='gmail_history'").get());assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='memory_sensitivity'").get());
   if(predecessor==='gmail'){assert.equal(db.prepare("SELECT message_id FROM gmail_arrivals").get().message_id,'retained');assert.equal(db.prepare('SELECT cursor FROM gmail_history').get().cursor,'17');}
   else {assert.equal(db.prepare('SELECT mode FROM memory_sensitivity').get().mode,'review-all');assert.equal(db.prepare('SELECT text FROM sensitive_memory_proposals').get().text,'pending detail');}
   assert.equal(db.prepare("SELECT connected FROM plugin_connections WHERE plugin_id='gmail'").get().connected,1);db.close();
  }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
 }
});


test('schema 44 chat grants do not authorize task or Slack model disclosure',()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-grant-migration-')),path=join(dir,'db');let instance;
 try {
  instance=new Instance(path);const bot=instance.createBot({name:'Existing',instructions:'',provider:'live',model:'fixture'});instance.close();instance=undefined;
  let db=new DatabaseSync(path);db.prepare("INSERT INTO plugin_connections VALUES ('gmail','owner@example.test',?,1,1,1)").run(JSON.stringify({email:'owner@example.test',clientId:'fixture'}));db.prepare("INSERT INTO gmail_model_access VALUES ('owner@example.test',?,'live','fixture')").run(bot.id);db.exec('DROP TABLE gmail_task_scopes; DROP TABLE gmail_task_messages; DROP TABLE gmail_private_tasks; DROP TABLE gmail_work_model_access; PRAGMA user_version=44');db.close();
  instance=new Instance(path);assert.equal(instance.plugins.gmailModelAllowed('owner@example.test',bot.id,'live','fixture'),true);assert.equal(instance.plugins.gmailWorkModelAllowed('owner@example.test',bot.id,'live','fixture'),false);
 }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
});
