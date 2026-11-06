import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { INSTANCE_SCHEMA_VERSION } from '../dist/instance.js';
import { MAINTENANCE_VERSION, saveBackup, sync, syncTree, writeMarker } from './dev-storage.mjs';

export function prepareUpgrade(dataRoot) {
  dataRoot=realpathSync(dataRoot);
  const path=join(dataRoot,'instance.sqlite'),marker=path+'.maintenance.json';
  if(existsSync(marker))throw Error('Dataset maintenance was interrupted. Run pnpm dev:recover.');
  if(!existsSync(path))return undefined;
  const db=new DatabaseSync(path);
  try {
    db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
    if(existsSync(marker))throw Error('Dataset maintenance was interrupted. Run pnpm dev:recover.');
    const version=Number(db.prepare('PRAGMA user_version').get().user_version);
    if(version>INSTANCE_SCHEMA_VERSION)throw Error(`Database version ${version} is newer than this Staf (maximum ${INSTANCE_SCHEMA_VERSION}). Use a compatible checkout, restore a matching backup, or explicitly reset the development dataset; the database was not reset. You may select another data directory.`);
    if(version===INSTANCE_SCHEMA_VERSION)return undefined;
    const backup=saveBackup({dataRoot,db,existed:true,reason:`upgrade-${version}`}),token=randomUUID();
    writeMarker({dataRoot,backup,token,schemaVersion:version,phase:'prepared',previousVersion:version});
    db.exec(`PRAGMA user_version=${MAINTENANCE_VERSION}`);sync(path);
    writeMarker({dataRoot,backup,token,schemaVersion:version,phase:'upgrading'});
    return {backup,token};
  } finally {db.close();}
}
export function finishUpgrade(dataRoot, releaseFence) {
  const path=join(dataRoot,'instance.sqlite'),agents=join(dataRoot,'agents'),core=join(dataRoot,'core');
  sync(path);if(existsSync(agents))syncTree(agents);if(existsSync(core))syncTree(core);sync(dataRoot);
  const record=JSON.parse(readFileSync(path+'.maintenance.json','utf8'));
  if(record.version!==1||record.phase!=='upgrading'||typeof record.backup!=='string'||typeof record.token!=='string'||!Number.isSafeInteger(record.schemaVersion))throw Error('Invalid upgrade maintenance marker.');
  writeMarker({dataRoot,backup:record.backup,token:record.token,schemaVersion:record.schemaVersion,publishedVersion:INSTANCE_SCHEMA_VERSION});
  releaseFence();sync(path);
  rmSync(path+'.maintenance.json');sync(dataRoot);
}
