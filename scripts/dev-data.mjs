import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { acquireOwner, devContext } from './dev-context.mjs';
import { seed } from './dev-seed.mjs';

const action=process.argv[2];
if (!['reset','recover'].includes(action)) throw Error('Use dev:reset or dev:recover');
const context=await devContext(), {dataRoot,connectionRoot}=context;
const path=join(dataRoot,'instance.sqlite'), marker=path+'.maintenance.json', backupRoot=join(dataRoot,'backups');
const agentRoot=join(dataRoot,'agents'), connectionInAgents=relative(agentRoot,connectionRoot);
if (!connectionInAgents || (!connectionInAgents.startsWith('..') && !isAbsolute(connectionInAgents))) throw Error('Connection directory cannot be inside the replaced agents directory');
function sync(path) {const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function syncTree(path) {const stat=lstatSync(path);if(stat.isDirectory()){for(const item of readdirSync(path))syncTree(join(path,item));sync(path);}else if(stat.isFile())sync(path);}
function copyAgents(from,to) {if(existsSync(from))cpSync(from,to,{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});}
function interrupted() {if(existsSync(marker))throw Error('Dataset maintenance was interrupted. Run pnpm dev:recover.');}
const owner=await acquireOwner(context);
let lock, stage;
try {
  if(action==='reset') {
    interrupted();
    stage=mkdtempSync(join(dataRoot,'.seed-'));seed(stage);syncTree(stage);
  } else if(!existsSync(marker)) throw Error('No interrupted dataset maintenance to recover.');
  const existed=existsSync(path);
  lock=new DatabaseSync(path);
  lock.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
  if(action==='reset') {
    interrupted();mkdirSync(backupRoot,{recursive:true,mode:0o700});
    const backup=join(backupRoot,`before-reset-${randomUUID()}`);mkdirSync(backup,{mode:0o700});
    if(existed)lock.prepare('VACUUM INTO ?').run(join(backup,'instance.sqlite'));
    copyAgents(agentRoot,join(backup,'agents'));
    writeFileSync(join(backup,'manifest.json'),JSON.stringify({version:1,database:existed}),{mode:0o600});syncTree(backup);sync(backupRoot);
    const pending=marker+'.new';
    writeFileSync(pending,JSON.stringify({version:1,backup}),{flag:'wx',mode:0o600});sync(pending);renameSync(pending,marker);sync(dataRoot);
    console.log(`Backup: ${backup}`);
  } else {
    const record=JSON.parse(readFileSync(marker,'utf8'));
    const rel=typeof record.backup==='string'?relative(backupRoot,record.backup):'..';
    if(record.version!==1 || !rel || rel.startsWith('..') || isAbsolute(rel))throw Error('Invalid maintenance marker; inspect the backup and marker before manual recovery.');
    const manifest=JSON.parse(readFileSync(join(record.backup,'manifest.json'),'utf8'));
    if(manifest.version!==1 || typeof manifest.database!=='boolean')throw Error('Invalid backup manifest.');
    stage=mkdtempSync(join(dataRoot,'.recovery-'));
    if(manifest.database)cpSync(join(record.backup,'instance.sqlite'),join(stage,'instance.sqlite'));
    copyAgents(join(record.backup,'agents'),join(stage,'agents'));syncTree(stage);
    console.log(`Restoring backup: ${record.backup}`);
  }
  // The durable marker remains in place through every destructive publication step.
  for(const suffix of ['-wal','-shm','-journal'])rmSync(path+suffix,{force:true});
  if(existsSync(join(stage,'instance.sqlite')))renameSync(join(stage,'instance.sqlite'),path);else rmSync(path,{force:true});
  rmSync(agentRoot,{recursive:true,force:true});
  if(existsSync(join(stage,'agents')))renameSync(join(stage,'agents'),agentRoot);
  sync(dataRoot);rmSync(marker);sync(dataRoot);
  console.log(action==='reset'?'Development dataset reset. Pair clients again.':'Recovery complete.');
} finally {
  lock?.close();if(stage)rmSync(stage,{recursive:true,force:true});
  await new Promise(resolve=>owner.close(resolve));
}
