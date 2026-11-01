import { spawn } from 'node:child_process';
import { constants, lstatSync, openSync, writeFileSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { isAbsolute, join } from 'node:path';

// stdout from the instance includes a pairing secret. Never forward it to the journal.
const runtime = process.env.RUNTIME_DIRECTORY;
const data = process.env.STAF_NATIVE_DATA;
if (!runtime || !isAbsolute(runtime) || !data || !isAbsolute(data)) throw new Error('Missing service paths');
const directory = lstatSync(runtime);
if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid() || (directory.mode & 0o077) !== 0) {
  throw new Error('Runtime directory is not private');
}
const codeFile = join(runtime, 'pairing-code');
try { unlinkSync(codeFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const child = spawn(process.execPath, ['dist/cli.js', 'instance', 'serve', join(data, 'instance.sqlite'), '3210'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stopping = false;
function fail() {
  console.error('Staf service failed; instance output is suppressed to protect pairing codes.');
  child.kill('SIGTERM');
  process.exitCode = 1;
}
const lines = createInterface({ input: child.stdout });
lines.on('line', (line) => {
  const match = /^Pairing code: ([A-Za-z0-9_-]{24})$/.exec(line);
  if (!match) return;
  const temporary = join(runtime, `pairing-code.${process.pid}.tmp`);
  let fd;
  try {
    fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, `${match[1]}\n`);
    closeSync(fd); fd = undefined;
    renameSync(temporary, codeFile);
    console.log('A pairing code is available in the private runtime directory.');
  } catch {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch {}
    fail();
  }
});
child.stderr.resume();
child.on('error', fail);
child.on('exit', (code, signal) => {
  try { unlinkSync(codeFile); } catch {}
  if (stopping) { console.log('Staf service stopped.'); process.exitCode = 0; }
  else { console.error(`Staf instance exited (${signal ?? code ?? 'unknown'}).`); process.exitCode = 1; }
});
process.on('SIGUSR1', () => {
  if (!stopping && child.stdin.writable) child.stdin.write('\n');
});
process.on('SIGTERM', () => { stopping = true; child.kill('SIGTERM'); });
console.log('Staf service starting; instance diagnostics are not written to the journal.');
