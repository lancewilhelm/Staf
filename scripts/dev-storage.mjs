import { createHash, randomUUID } from 'node:crypto';
import { closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Older Staf constructors reject versions newer than their supported schema.
export const MAINTENANCE_VERSION=2147483647;

export function sync(path) {const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
export function syncTree(path) {const stat=lstatSync(path);if(stat.isDirectory()){for(const item of readdirSync(path))syncTree(join(path,item));sync(path);}else if(stat.isFile())sync(path);}
export function copyAgents(from,to) {if(existsSync(from))cpSync(from,to,{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});}
// Retired core revisions seal file identity as well as content. Rebase a valid
// seal onto the copied inode, but keep an invalid seal invalid for recovery.
function coreFingerprint(dir) {
  const path=join(dir,'core.md');if(!existsSync(path))return 'absent';
  const stat=statSync(path,{bigint:true}),bytes=readFileSync(path);
  return createHash('sha256').update([stat.dev,stat.ino,stat.size,stat.ctimeNs,stat.mtimeNs].join(':')).update('\0').update(bytes.toString('utf8')).digest('hex');
}
export function copyCore(from,to) {
  if(!existsSync(from))return;
  copyAgents(from,to);
  const revisions=join(from,'revisions');if(!existsSync(revisions))return;
  for(const item of readdirSync(revisions,{withFileTypes:true})) {
    if(!item.isDirectory())continue;
    const source=join(revisions,item.name),target=join(to,'revisions',item.name),marker=join(source,'.retired');
    if(!existsSync(marker))continue;
    const sealed=readFileSync(marker,'utf8'),before=coreFingerprint(source);
    if(sealed!==before)continue;
    const sourceFile=join(source,'core.md'),targetFile=join(target,'core.md');
    if(existsSync(sourceFile)!==existsSync(targetFile) || (existsSync(sourceFile) && !readFileSync(sourceFile).equals(readFileSync(targetFile))) || coreFingerprint(source)!==before)throw Error('Core revision changed while copying. Retry maintenance.');
    writeFileSync(join(target,'.retired'),coreFingerprint(target),{mode:0o600});
  }
}
export function saveBackup({dataRoot,db,existed,reason}) {
  const backupRoot=join(dataRoot,'backups');mkdirSync(backupRoot,{recursive:true,mode:0o700});
  const backup=join(backupRoot,`before-${reason}-${randomUUID()}`);mkdirSync(backup,{mode:0o700});
  if(existed)db.prepare('VACUUM INTO ?').run(join(backup,'instance.sqlite'));
  copyAgents(join(dataRoot,'agents'),join(backup,'agents'));
  copyCore(join(dataRoot,'core'),join(backup,'core'));
  writeFileSync(join(backup,'manifest.json'),JSON.stringify({version:1,database:existed}),{mode:0o600});syncTree(backup);sync(backupRoot);sync(dataRoot);
  return backup;
}
export function writeMarker({dataRoot,backup,token,schemaVersion,phase,previousVersion,publishedVersion}) {
  const marker=join(dataRoot,'instance.sqlite.maintenance.json'),pending=marker+'.'+randomUUID();
  writeFileSync(pending,JSON.stringify({version:1,backup,...(token?{token,schemaVersion}:{}),...(phase?{phase}:{}),...(previousVersion===undefined?{}:{previousVersion}),...(publishedVersion===undefined?{}:{phase:'published',publishedVersion})}),{flag:'wx',mode:0o600});sync(pending);renameSync(pending,marker);sync(dataRoot);
}
