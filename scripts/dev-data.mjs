import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { acquireOwner, devContext } from './dev-context.mjs';
import { seed } from './dev-seed.mjs';
import { copyAgents, saveBackup, sync, syncTree, writeMarker } from './dev-storage.mjs';

async function main() {
const action=process.argv[2];
if (!['reset','recover','restore'].includes(action)) throw Error('Use dev:reset, dev:recover, or dev:restore BACKUP');
const context=await devContext(), {dataRoot,connectionRoot}=context;
const path=join(dataRoot,'instance.sqlite'), marker=path+'.maintenance.json', backupRoot=join(dataRoot,'backups');
const agentRoot=join(dataRoot,'agents'), connectionInAgents=relative(agentRoot,connectionRoot);
if (!connectionInAgents || (!connectionInAgents.startsWith('..') && !isAbsolute(connectionInAgents))) throw Error('Connection directory cannot be inside the replaced agents directory');
function interrupted() {if(existsSync(marker))throw Error('Dataset maintenance was interrupted. Run pnpm dev:recover.');}
async function testCheckpoint(name) {
  if(process.env.STAF_DEV_TEST_PAUSE !== name || !process.send) return;
  process.send({checkpoint:name});
  await new Promise(resolve=>process.once('message',resolve));
}
const owner=await acquireOwner(context);
let lock, stage;
try {
  if(action==='reset') {
    interrupted();
    stage=mkdtempSync(join(dataRoot,'.seed-'));seed(stage);syncTree(stage);
  } else if(action==='recover') {if(!existsSync(marker))throw Error('No interrupted dataset maintenance to recover.');}
  else interrupted();
  const existed=existsSync(path);
  lock=new DatabaseSync(path);
  lock.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
  if(action==='reset') {
    interrupted();
    const backup=saveBackup({dataRoot,db:lock,existed,reason:'reset'});
    writeMarker({dataRoot,backup});
    console.log(`Backup: ${backup}`);
  } else {
    let target;
    if(action==='restore') {
      interrupted();
      if(!process.argv[3])throw Error('Supply a backup directory printed by Staf.');
      target=resolve(process.argv[3]);
    } else {
      const record=JSON.parse(readFileSync(marker,'utf8'));
      if(record.version!==1 || typeof record.backup!=='string')throw Error('Invalid maintenance marker; inspect it before manual recovery.');
      target=record.backup;
    }
    const rel=relative(backupRoot,target);
    if(!rel || rel.startsWith('..') || isAbsolute(rel))throw Error('Backup must be inside this development data directory.');
    const manifest=JSON.parse(readFileSync(join(target,'manifest.json'),'utf8'));
    if(manifest.version!==1 || typeof manifest.database!=='boolean')throw Error('Invalid backup manifest.');
    stage=mkdtempSync(join(dataRoot,'.recovery-'));
    if(manifest.database)cpSync(join(target,'instance.sqlite'),join(stage,'instance.sqlite'));
    copyAgents(join(target,'agents'),join(stage,'agents'));
    if(action==='restore' && manifest.database) {
      const restored=new DatabaseSync(join(stage,'instance.sqlite'));
      try {
        restored.exec('BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS instance_secrets (name TEXT PRIMARY KEY, value BLOB NOT NULL)');
        restored.prepare("INSERT OR REPLACE INTO instance_secrets VALUES ('dataset-identity',?)").run(randomBytes(32));
        for(const name of ['clients','local_bootstrap'])if(restored.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))restored.exec(`DELETE FROM ${name}`);
        restored.exec('COMMIT');
      } finally {restored.close();}
    }
    syncTree(stage);
    if(action==='restore') {const backup=saveBackup({dataRoot,db:lock,existed,reason:'restore'});writeMarker({dataRoot,backup});console.log(`Backup: ${backup}`);}
    console.log(`Restoring backup: ${target}`);
  }
  // The durable marker remains in place through every destructive publication step.
  for(const suffix of ['-wal','-shm','-journal'])rmSync(path+suffix,{force:true});
  if(existsSync(join(stage,'instance.sqlite')))renameSync(join(stage,'instance.sqlite'),path);else rmSync(path,{force:true});
  await testCheckpoint('database-published');
  rmSync(agentRoot,{recursive:true,force:true});
  if(existsSync(join(stage,'agents')))renameSync(join(stage,'agents'),agentRoot);
  sync(dataRoot);rmSync(marker);sync(dataRoot);
  console.log(action==='reset'?'Development dataset reset. Pair clients again.':'Recovery complete.');
} finally {
  lock?.close();if(stage)rmSync(stage,{recursive:true,force:true});
  await new Promise(resolve=>owner.close(resolve));
}

}
try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1; }
