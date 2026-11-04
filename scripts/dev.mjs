import { request } from 'node:http';
import { spawn, fork } from 'node:child_process';
import { join, resolve } from 'node:path';
import { acquireOwner, devContext } from './dev-context.mjs';
import { createInterface } from 'node:readline';
import { createServer as createViteServer } from 'vite';

const context = await devContext();
const {checkout,dataRoot,connectionRoot,port,origin} = context;
let owner;
let vite, backend, backendPort, build, timer, shuttingDown = false, restartRunning = false, restartPending = false;
async function closeOwner() { if (owner.listening) await new Promise(resolve => owner.close(resolve)); }
async function stopBackend() {
  if (!backend) return;
  const child = backend; backend = undefined; backendPort = undefined;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => { child.once('exit', resolve); if (child.connected) child.send('stop'); else child.kill('SIGTERM'); });
}
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true; clearTimeout(timer); build?.kill('SIGTERM');
  await stopBackend(); await vite?.close(); await closeOwner();
  process.exit(code);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

async function compile() {
  return new Promise((resolveResult, reject) => {
    build = spawn(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {cwd:checkout, stdio:'inherit'});
    build.once('error', reject);
    build.once('exit', code => {build = undefined; code === 0 ? resolveResult() : reject(Error('Backend compilation failed'));});
  });
}
async function startBackend() {
  const child = fork(join(checkout, 'scripts/dev-backend.mjs'), [dataRoot, origin, connectionRoot], {cwd:checkout, stdio:['ignore','inherit','inherit','ipc']});
  backend = child;
  await new Promise((resolveResult, reject) => {
    const exited = () => reject(Error('Backend exited during startup; see diagnostic above'));
    child.once('exit', exited);
    child.on('message', message => {
      if (message?.kind === 'pair') console.log(`Pairing code: ${message.code}`);
      if (message?.kind !== 'ready') return;
      child.off('exit', exited); backendPort = message.port;
      if (message.backup) console.log(`Database backup before migration: ${message.backup}`);
      console.log(`Backend ready. Pairing code: ${message.code}\nPress Enter for a new pairing code.`);
      resolveResult();
    });
  });
  child.once('exit', (code, signal) => {
    if (backend === child && !shuttingDown) {backend = undefined; backendPort = undefined; console.error(`Backend exited (${signal || code}). Fix the problem and edit a backend file to retry.`);}
  });
}
async function restart() {
  if (restartRunning) { restartPending = true; return; }
  restartRunning = true;
  do {
    restartPending = false;
    try {
      console.log('Building backend...'); await compile();
      if (shuttingDown) break;
      await stopBackend();
      if (shuttingDown) break;
      await startBackend();
    } catch (error) { if (!shuttingDown) console.error(error instanceof Error ? error.message : String(error)); }
  } while (restartPending && !shuttingDown);
  restartRunning = false;
}
try { owner = await acquireOwner(context); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
try {
  vite = await createViteServer({configFile:join(checkout, 'vite.config.ts'), cacheDir:join(checkout,'.cache','vite-dev'), server:{host:'127.0.0.1',port,strictPort:true}, plugins:[{name:'staf-dev-service',configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/__staf_dev/status' && req.headers.host === `127.0.0.1:${port}` && !req.headers.origin) {res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({checkout, dataDir:dataRoot})); return;}
      if (!req.url?.startsWith('/api/') && !req.url?.startsWith('/auth/callback')) return next();
      if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)) {res.writeHead(403).end('Invalid origin'); return;}
      if (!backendPort) {res.writeHead(503, {'Content-Type':'application/json'}).end(JSON.stringify({error:'Backend restarting'})); return;}
      const upstream = request({host:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers:req.headers}, response => {res.writeHead(response.statusCode || 502, response.headers); response.on('aborted', () => res.destroy());response.pipe(res);});
      upstream.on('error', () => {if (!res.headersSent) res.writeHead(503);res.end();});
      res.on('close', () => upstream.destroy());
      req.pipe(upstream);
    });
  }}]});
  await vite.listen();
  console.log(`Checkout: ${checkout}\nData directory: ${dataRoot}\nConnection directory: ${connectionRoot}\nWorkspace: ${origin}\nBackend starting...`);
  await restart();
  if (!backendPort) throw Error('Backend did not start');
  vite.watcher.add([join(checkout, 'src'),join(checkout,'tsconfig.json')]);
  vite.watcher.on('all', (_event, path) => {
    const name = resolve(path);
    if (name === join(checkout,'tsconfig.json') || name.startsWith(join(checkout,'src') + '/')) {
      clearTimeout(timer); timer = setTimeout(() => void restart(), 200);
    }
  });
  const input = createInterface({input:process.stdin}); input.on('line', () => {if (backend?.connected) backend.send('pair');});
} catch (error) {
  if (!vite?.httpServer?.listening) {
    try {const response = await fetch(`${origin}/__staf_dev/status`, {signal:AbortSignal.timeout(500)}); const info = await response.json(); if (typeof info.checkout === 'string') console.error(`Port ${port} is in use. Active checkout: ${info.checkout}; data directory: ${info.dataDir}.`);} catch {}
  }
  console.error(`Development launcher failed: ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
}
