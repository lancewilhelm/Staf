import { randomUUID } from 'node:crypto';
import { closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function sync(path) {const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
export function syncTree(path) {const stat=lstatSync(path);if(stat.isDirectory()){for(const item of readdirSync(path))syncTree(join(path,item));sync(path);}else if(stat.isFile())sync(path);}
export function copyAgents(from,to) {if(existsSync(from))cpSync(from,to,{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});}
export function saveBackup({dataRoot,db,existed,reason}) {
  const backupRoot=join(dataRoot,'backups');mkdirSync(backupRoot,{recursive:true,mode:0o700});
  const backup=join(backupRoot,`before-${reason}-${randomUUID()}`);mkdirSync(backup,{mode:0o700});
  if(existed)db.prepare('VACUUM INTO ?').run(join(backup,'instance.sqlite'));
  copyAgents(join(dataRoot,'agents'),join(backup,'agents'));
  writeFileSync(join(backup,'manifest.json'),JSON.stringify({version:1,database:existed}),{mode:0o600});syncTree(backup);sync(backupRoot);sync(dataRoot);
  return backup;
}
export function writeMarker({dataRoot,backup,token}) {
  const marker=join(dataRoot,'instance.sqlite.maintenance.json'),pending=marker+'.'+randomUUID();
  writeFileSync(pending,JSON.stringify({version:1,backup,...(token?{token}:{})}),{flag:'wx',mode:0o600});sync(pending);renameSync(pending,marker);sync(dataRoot);
}
