import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Instance } from '../dist/instance.js';

const command = (root, action) => spawnSync(process.execPath, ['scripts/dev-data.mjs', action], {cwd:process.cwd(), env:{...process.env,STAF_DEV_DATA_DIR:root}, encoding:'utf8'});
test('reset builds fresh representative data while retaining connections and a complete backup', () => {
  const root=mkdtempSync(join(tmpdir(),'staf-dev-data-')), path=join(root,'instance.sqlite');
  try {
    mkdirSync(join(root,'auth')); writeFileSync(join(root,'auth','codex-host.json'),'synthetic-registration');
    let prior=new Instance(path); const bot=prior.createBot({name:'Before reset',instructions:'Keep this soul',provider:'demo'}); prior.close();
    const result=command(root,'reset'); assert.equal(result.status,0,result.stderr);
    assert.equal(readFileSync(join(root,'auth','codex-host.json'),'utf8'),'synthetic-registration');
    const next=new Instance(path); const bots=next.bots(); assert.ok(bots.length>=3); assert.ok(!bots.some(item=>item.id===bot.id));
    assert.ok(bots.some(item=>next.messages(item.id).length>=8)); next.close();
    assert.match(result.stdout,/backup/i);
    const backup=result.stdout.match(/Backup: (.+)/)?.[1]; assert.ok(backup);
    prior=new Instance(join(backup,'instance.sqlite')); assert.equal(prior.bot(bot.id).instructions,'Keep this soul'); prior.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});
