import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';

export async function devContext() {
  const checkout = await realpath(process.cwd());
  const dataDir = resolve(process.env.STAF_DEV_DATA_DIR || join(homedir(), '.staf', 'development'));
  const port = Number(process.env.STAF_DEV_PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('STAF_DEV_PORT must be a port from 1 to 65535');
  await mkdir(dataDir, {recursive:true, mode:0o700});
  const dataRoot = await realpath(dataDir);
  const connectionRoot = process.env.STAF_DEV_CONNECTION_DIR ? await realpath(resolve(process.env.STAF_DEV_CONNECTION_DIR)) : dataRoot;
  if (!(await stat(connectionRoot)).isDirectory()) throw Error('STAF_DEV_CONNECTION_DIR must be an existing Staf data directory');
  const inCheckout = relative(checkout, dataRoot);
  if (!inCheckout || (!inCheckout.startsWith('..') && !isAbsolute(inCheckout))) throw Error('Development data must be outside the checkout');
  const ownerPort = 20000 + createHash('sha256').update(dataRoot).digest().readUInt32BE(0) % 35000;
  return {checkout,dataRoot,connectionRoot,port,ownerPort,origin:`http://127.0.0.1:${port}`};
}
export async function acquireOwner({checkout,dataRoot,port,ownerPort}) {
  const owner = createServer((_req,res) => res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({checkout,dataDir:dataRoot,port,pid:process.pid})));
  try {await new Promise((resolveResult,reject)=>{owner.once('error',reject);owner.listen(ownerPort,'127.0.0.1',resolveResult);});}
  catch {
    let detail='The ownership port is occupied by an unknown process.';
    try {const response=await fetch(`http://127.0.0.1:${ownerPort}`,{signal:AbortSignal.timeout(500)});const info=await response.json();if(info.dataDir===dataRoot)detail=`Active checkout: ${info.checkout}; data directory: ${info.dataDir}; port: ${info.port}.`;} catch {}
    throw Error(`Development instance ownership conflict. ${detail}`);
  }
  return owner;
}
