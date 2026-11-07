import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { acquireOwner, devContext } from './dev-context.mjs';
import { seed } from './dev-seed.mjs';
import { copyAgents, copyCore, MAINTENANCE_VERSION, saveBackup, sync, syncTree, writeMarker } from './dev-storage.mjs';

async function main() {
const action=process.argv[2];
if (!['reset','recover','restore'].includes(action)) throw Error('Use dev:reset, dev:recover, or dev:restore BACKUP');
const context=await devContext(), {dataRoot,connectionRoot}=context;
const path=join(dataRoot,'instance.sqlite'), marker=path+'.maintenance.json', backupRoot=join(dataRoot,'backups');
const agentRoot=join(dataRoot,'agents'), connectionInAgents=relative(agentRoot,connectionRoot);
if (!connectionInAgents || (!connectionInAgents.startsWith('..') && !isAbsolute(connectionInAgents))) throw Error('Connection directory cannot be inside the replaced agents directory');
const coreRoot=join(dataRoot,'core'), connectionInCore=relative(coreRoot,connectionRoot);
if (!connectionInCore || (!connectionInCore.startsWith('..') && !isAbsolute(connectionInCore))) throw Error('Connection directory cannot be inside the replaced core directory');
function interrupted() {if(existsSync(marker))throw Error('Dataset maintenance was interrupted. Run pnpm dev:recover.');}
async function testCheckpoint(name) {
  if(process.env.STAF_DEV_TEST_PAUSE !== name || !process.send) return;
  process.send({checkpoint:name});
  await new Promise(resolve=>process.once('message',resolve));
}
const owner=await acquireOwner(context);
let lock, publishedLock, stage;
try {
  if(action==='reset') {
    interrupted();
    stage=mkdtempSync(join(dataRoot,'.seed-'));seed(stage);syncTree(stage);
  } else if(action==='recover') {if(!existsSync(marker))throw Error('No interrupted dataset maintenance to recover.');}
  else interrupted();
  const existed=existsSync(path);
  lock=new DatabaseSync(path);
  lock.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
  if(action==='recover') {
    const record=JSON.parse(readFileSync(marker,'utf8'));
    if(record.version!==1||typeof record.backup!=='string'||(record.phase!==undefined&&!['prepared','replacing','upgrading','published'].includes(record.phase)))throw Error('Invalid maintenance marker; inspect it before manual recovery.');
    if(record.phase==='published'||record.phase==='prepared') {
      const version=record.phase==='published'?record.publishedVersion:record.previousVersion;
      if(!Number.isSafeInteger(version)||version<0||version>=MAINTENANCE_VERSION)throw Error('Invalid maintenance schema version.');
      const actual=Number(lock.prepare('PRAGMA user_version').get().user_version);
      if(actual===MAINTENANCE_VERSION){lock.exec(`PRAGMA user_version=${version}`);sync(path);}
      else if(!Number.isSafeInteger(actual)||actual<version||actual>=MAINTENANCE_VERSION)throw Error('Unexpected published schema version.');
      rmSync(marker);sync(dataRoot);console.log(record.phase==='published'?'Committed publication finalized.':'Original dataset retained.');return;
    }
  }
  if(action==='reset') {
    interrupted();
    const backup=saveBackup({dataRoot,db:lock,existed,reason:'reset'});
    const previousVersion=Number(lock.prepare('PRAGMA user_version').get().user_version);
    if(!Number.isSafeInteger(previousVersion)||previousVersion<0||previousVersion>=MAINTENANCE_VERSION)throw Error('Invalid original schema version.');
    writeMarker({dataRoot,backup,phase:'prepared',previousVersion});
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
    copyCore(join(target,'core'),join(stage,'core'));
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
    if(action==='restore') {const backup=saveBackup({dataRoot,db:lock,existed,reason:'restore'});const previousVersion=Number(lock.prepare('PRAGMA user_version').get().user_version);if(!Number.isSafeInteger(previousVersion)||previousVersion<0||previousVersion>=MAINTENANCE_VERSION)throw Error('Invalid original schema version.');writeMarker({dataRoot,backup,phase:'prepared',previousVersion});console.log(`Backup: ${backup}`);}
    console.log(`Restoring backup: ${target}`);
  }
  await testCheckpoint('backup-saved');
  // Fence both inodes: a lock on the original does not protect a renamed replacement.
  lock.exec(`PRAGMA user_version=${MAINTENANCE_VERSION}`);sync(path);
  await testCheckpoint('original-fenced');
  const stagedPath=join(stage,'instance.sqlite');
  publishedLock=new DatabaseSync(stagedPath);
  publishedLock.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
  const targetVersion=Number(publishedLock.prepare('PRAGMA user_version').get().user_version);
  if(!Number.isSafeInteger(targetVersion)||targetVersion<0||targetVersion>=MAINTENANCE_VERSION)throw Error('Invalid backup schema version.');
  publishedLock.exec(`PRAGMA user_version=${MAINTENANCE_VERSION}`);sync(stagedPath);sync(stage);
  const active=JSON.parse(readFileSync(marker,'utf8'));
  if(active.version!==1||typeof active.backup!=='string')throw Error('Invalid maintenance marker.');
  writeMarker({dataRoot,backup:active.backup,phase:'replacing'});
  // SQLite derives its journal path when opened. Reopen after publishing so a
  // later write cannot leave the live journal in the temporary directory.
  publishedLock.close();publishedLock=undefined;
  // The durable marker remains in place through every destructive publication step.
  for(const suffix of ['-wal','-shm','-journal'])rmSync(path+suffix,{force:true});
  renameSync(stagedPath,path);sync(dataRoot);
  publishedLock=new DatabaseSync(path);
  publishedLock.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
  await testCheckpoint('database-published');
  rmSync(agentRoot,{recursive:true,force:true});
  if(existsSync(join(stage,'agents')))renameSync(join(stage,'agents'),agentRoot);
  rmSync(coreRoot,{recursive:true,force:true});
  if(existsSync(join(stage,'core')))renameSync(join(stage,'core'),coreRoot);
  sync(dataRoot);
  await testCheckpoint('files-published');
  const record=JSON.parse(readFileSync(marker,'utf8'));
  if(record.version!==1||typeof record.backup!=='string')throw Error('Invalid maintenance marker.');
  writeMarker({dataRoot,backup:record.backup,publishedVersion:targetVersion});
  await testCheckpoint('publication-committed');
  publishedLock.exec(`PRAGMA user_version=${targetVersion}`);sync(path);
  await testCheckpoint('fence-released');
  rmSync(marker);sync(dataRoot);
  console.log(action==='reset'?'Development dataset reset. Pair clients again.':'Recovery complete.');
} finally {
  publishedLock?.close();lock?.close();if(stage)rmSync(stage,{recursive:true,force:true});
  await new Promise(resolve=>owner.close(resolve));
}

}
try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1; }
