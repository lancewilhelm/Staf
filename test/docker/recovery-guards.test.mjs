import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile), root = resolve(import.meta.dirname, '../..');
// Only Docker command failures are simulated. No daemon, mounts or real archives.
async function fixture(t, failure) {
  const directory = await mkdtemp(join(tmpdir(), 'staf-recovery-guards-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const bin = join(directory, 'bin'), log = join(directory, 'commands');
  await mkdir(bin); await writeFile(log, '');
  const env = {...process.env, PATH: `${bin}:${process.env.PATH}`, STAF_GUARD_LOG: log, STAF_GUARD_FAILURE: failure};
  await writeFile(join(bin, 'docker'), `#!/usr/bin/env node
    const {appendFileSync,readFileSync} = require('node:fs');
    const {execFileSync} = require('node:child_process');
    const args = process.argv.slice(2);
    appendFileSync(process.env.STAF_GUARD_LOG, JSON.stringify(args)+'\\n');
    if (args[0] === 'image') process.exit(0);
    if (args[0] === 'inspect') {console.log('/data|bind|'); process.exit(0);}
    if (args[0] === 'volume') {console.log('staf-data'); process.exit(0);}
    if (args[0] === 'ps') process.exit(process.env.STAF_GUARD_FAILURE === 'ps' ? 42 : 0);
    if (args[0] === 'run') {
      const result = require('node:child_process').spawnSync(process.execPath, ['-e', args.at(-1)], {input:readFileSync(0),stdio:['pipe','inherit','inherit']});
      process.exit(result.status);
    }
    if (args.includes('config')) {
      if (args.includes('--format')) {
        const mount = process.env.STAF_GUARD_FAILURE === 'bind' ? {type:'bind',source:'/synthetic/data',target:'/data'} : {type:'volume',source:'staf-data',target:'/data'};
        const service = {volumes:[mount]};
        const extra = process.env.STAF_GUARD_FAILURE;
        if (['volumes_from','tmpfs','configs','secrets'].includes(extra)) {
          service[extra] = extra === 'volumes_from' ? ['container:synthetic-source:rw'] : extra === 'tmpfs' ? ['/data/temporary'] : [{source:'synthetic',target:'/data/other'}];
        }
        console.log(JSON.stringify({services:{staf:service},volumes:{'staf-data':{name:'configured-data'}}}));
      } else console.log('synthetic-image');
      process.exit(0);
    }
    if (args[0] === 'compose' && args.includes('ps')) {if(process.env.STAF_GUARD_FAILURE === 'drift') console.log('synthetic-container'); process.exit(0);}
    if (args.includes('run')) {
      if (process.env.STAF_GUARD_FAILURE === 'ps') process.exit(43);
      const result = require('node:child_process').spawnSync('/bin/sh', ['-eu','-c',args.at(-1)], {env:process.env,stdio:'inherit'});
      process.exit(result.status);
    }
    process.exit(0);
  `, {mode: 0o700});
  await writeFile(join(bin, 'find'), '#!/bin/sh\nexit 42\n', {mode: 0o700});
  await writeFile(join(bin, 'tar'), `#!/bin/sh\nprintf 'UNSAFE_TAR_REACHED\\n' >> "$STAF_GUARD_LOG"\nexit 43\n`, {mode: 0o700});
  const archive = join(directory, 'archive.tar'); await writeFile(archive, 'synthetic');
  return {directory, archive, log, env};
}

test('backup aborts if running-container inspection fails', async t => {
  const f = await fixture(t, 'ps');
  await assert.rejects(run('/bin/sh', ['deploy/docker-data.sh', 'backup', 'staf', join(f.directory, 'backups')], {cwd: root, env: f.env}), error => error.code === 42);
  assert.ok(!(await readFile(f.log, 'utf8')).split('\n').some(line => line.includes('"compose"') && line.includes('"run"')), 'no archive command after failed inspection');
});

test('restore aborts if destination emptiness inspection fails', async t => {
  const f = await fixture(t, 'find');
  await assert.rejects(run('/bin/sh', ['deploy/docker-data.sh', 'restore', 'staf', f.archive], {cwd: root, env: f.env}), error => error.code === 42);
  assert.ok(!(await readFile(f.log, 'utf8')).includes('UNSAFE_TAR_REACHED'), 'no extraction after failed inspection');
});

test('recovery honors the Compose file stack and its configured volume name', async t => {
  const f = await fixture(t, 'ps');
  f.env.COMPOSE_FILE = 'compose.yaml:reviewed-provider-override.yaml';
  await assert.rejects(run('/bin/sh', ['deploy/docker-data.sh', 'backup', 'staf', join(f.directory, 'backups')], {cwd: root, env: f.env}), error => error.code === 42);
  const commands = (await readFile(f.log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(commands.filter(args => args.includes('config')).every(args => !args.includes('-f')), 'do not replace COMPOSE_FILE/default overrides with base-only configuration');
  assert.ok(commands.some(args => args[0] === 'ps' && args.includes('volume=configured-data')), 'guard the volume resolved from the actual Compose stack');
});

test('recovery rejects bind-mounted data instead of archiving a stale named volume', async t => {
  const f = await fixture(t, 'bind');
  await assert.rejects(run('/bin/sh', ['deploy/docker-data.sh', 'restore', 'staf', f.archive], {cwd: root, env: f.env}), error => /named.*data volume/i.test(error.stderr));
  assert.ok(!(await readFile(f.log, 'utf8')).split('\n').some(line => line.includes('"compose"') && line.includes('"run"')), 'do not mount another data store');
});

test('recovery refuses an installed service using a different data store', async t => {
  const f = await fixture(t, 'drift');
  await assert.rejects(run('/bin/sh', ['deploy/docker-data.sh', 'backup', 'staf', join(f.directory, 'backups')], {cwd: root, env: f.env}), error => /Installed service uses a different data store/.test(error.stderr));
  assert.ok(!(await readFile(f.log, 'utf8')).split('\n').some(line => line.includes('"compose"') && line.includes('"run"')), 'no archive command for a mismatched installed mount');
});

for (const kind of ['volumes_from', 'tmpfs', 'configs', 'secrets']) {
  test(`recovery refuses unsupported ${kind} mounts before a fresh restore`, async t => {
    const f = await fixture(t, kind);
    await assert.rejects(run('/bin/sh', ['deploy/docker-data.sh', 'restore', 'staf', f.archive], {cwd: root, env: f.env}), error => error.stderr.includes(`does not support ${kind}`));
    assert.ok(!(await readFile(f.log, 'utf8')).split('\n').some(line => line.includes('"compose"') && line.includes('"run"')), 'no extraction with alternative data mounts');
  });
}
