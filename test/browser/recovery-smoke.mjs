// Exercise the actual-container client journey locally when Docker is unavailable.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {startInstance} from '../../dist/instance-service.js';
import {api, seedRecovery} from '../helpers/recovery.mjs';
import {pairedClientJourney} from '../helpers/paired-browser.mjs';

const run = promisify(execFile), root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(join(tmpdir(), 'staf-recovery-browser-'));
const credential = join(temp, 'client.json');
const app = startInstance(join(temp, 'instance.sqlite'), 0, {env: {}});
try {
  const origin = `http://127.0.0.1:${await app.listen()}`;
  const cli = async (action, ...args) => (await run(process.execPath, ['dist/cli.js', 'instance', action, origin, credential, ...args], {cwd: root})).stdout;
  await cli('pair', app.code);
  const {token} = JSON.parse(await readFile(credential, 'utf8'));
  const call = api(origin, token), bot = await seedRecovery(call);
  await pairedClientJourney({origin, code: app.issueCode(), directory: join(temp, 'browser'), cli, bot, call});
  console.log('PASS current browser/CLI pairing, shared Demo chat and revoked-browser reload (local process; no Docker or SSH evidence)');
} finally {
  if (app.server.listening) await app.close();
  await rm(temp, {recursive: true, force: true});
}
