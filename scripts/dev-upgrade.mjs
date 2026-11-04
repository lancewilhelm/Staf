import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { INSTANCE_SCHEMA_VERSION } from '../dist/instance.js';
import { saveBackup, sync, syncTree, writeMarker } from './dev-storage.mjs';

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
    const hasBots=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bots'").get();
    if(!hasBots||version===INSTANCE_SCHEMA_VERSION)return undefined;
    const backup=saveBackup({dataRoot,db,existed:true,reason:`upgrade-${version}`}),token=randomUUID();
    writeMarker({dataRoot,backup,token});return {backup,token};
  } finally {db.close();}
}
export function finishUpgrade(dataRoot) {
  const path=join(dataRoot,'instance.sqlite'),agents=join(dataRoot,'agents');
  sync(path);if(existsSync(agents))syncTree(agents);sync(dataRoot);
  rmSync(path+'.maintenance.json');sync(dataRoot);
}
