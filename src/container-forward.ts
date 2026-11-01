import { mkdir } from 'node:fs/promises';
import { createServer, connect, type Socket } from 'node:net';
import { createInterface } from 'node:readline';
import { startInstance } from './instance-service.js';

await mkdir('/data', { recursive: true, mode: 0o700 });
const app = startInstance('/data/instance.sqlite', 3210);
await app.listen();
if (app.migrationBackup) console.log(`Database backup before migration: ${app.migrationBackup}`);
console.log(`Listening on http://127.0.0.1:3210\nPairing code: ${app.code}\nPress Enter to issue a new pairing code.`);
const input = createInterface({ input: process.stdin });
input.on('line', () => console.log(`Pairing code: ${app.issueCode()}`));
const sockets = new Set<Socket>();
const forwarder = createServer((incoming) => {
  const upstream = connect(3210, '127.0.0.1');
  sockets.add(incoming);
  sockets.add(upstream);
  incoming.on('close', () => sockets.delete(incoming));
  upstream.on('close', () => sockets.delete(upstream));
  incoming.on('error', () => upstream.destroy());
  upstream.on('error', () => incoming.destroy());
  incoming.pipe(upstream).pipe(incoming);
});
forwarder.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
forwarder.listen(3211, '0.0.0.0');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    input.close();
    forwarder.close();
    for (const socket of sockets) socket.destroy();
    void app.close().then(() => process.exit(0), (error: unknown) => {
      console.error(error);
      process.exit(1);
    });
  });
}
