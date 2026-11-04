import { startInstance } from '../dist/instance-service.js';
import { join } from 'node:path';

let app;
try {
  app = startInstance(join(process.argv[2], 'instance.sqlite'), 0, {dataDir:process.argv[4], publicOrigin:process.argv[3]});
  const port = await app.listen();
  process.send?.({kind:'ready', port, code:app.code, backup:app.migrationBackup});
  process.on('message', message => {
    if (message === 'pair') process.send?.({kind:'pair', code:app.issueCode()});
    if (message === 'stop') void stop();
  });
  process.once('disconnect', () => void stop());
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
} catch (error) {
  console.error(`Backend startup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
  process.disconnect?.();
}
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try { await app?.close(); } finally { process.exit(); }
}
