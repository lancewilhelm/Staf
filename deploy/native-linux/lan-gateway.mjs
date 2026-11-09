import {createServer} from 'node:https';
import {request} from 'node:http';
import {readFileSync} from 'node:fs';
import {isIP} from 'node:net';
import {pathToFileURL} from 'node:url';

// The upstream is deliberately fixed to loopback; the gateway is not an open proxy.
export function createLanGateway({address, backendPort = 3210, key, cert}) {
 const server=createServer({key,cert},(req,res)=>{
  const bound=server.address();
  const origin=`https://${address}:${bound.port}`;
  const hosts=req.rawHeaders.filter((_,i)=>i%2===0 && req.rawHeaders[i].toLowerCase()==='host');
  if(hosts.length!==1 || req.headers.host!==new URL(origin).host || (req.headers.origin && req.headers.origin!==origin)) {
   res.writeHead(403,{'Cache-Control':'no-store'});res.end('Invalid origin');return;
  }
  const headers={...req.headers,host:`127.0.0.1:${backendPort}`};
  if(headers.origin) headers.origin=`http://127.0.0.1:${backendPort}`;
  for(const name of ['connection','proxy-connection','keep-alive','upgrade','te','trailer','transfer-encoding','forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto']) delete headers[name];
  const upstream=request({host:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers},response=>{
   res.writeHead(response.statusCode ?? 502,response.headers);response.pipe(res);
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Cache-Control':'no-store'});res.end();});
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
 });
 return server;
}

function privateAddress(value) {
 if(isIP(value)!==4)return false;
 const [a,b]=value.split('.').map(Number);
 return a===10 || (a===172 && b>=16 && b<=31) || (a===192 && b===168);
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 const address=process.env.STAF_LAN_ADDRESS, port=Number(process.env.STAF_LAN_PORT || 3443);
 const key=process.env.STAF_LAN_KEY,cert=process.env.STAF_LAN_CERT;
 if(!address || !privateAddress(address) || !Number.isInteger(port) || port<1024 || port>65535 || !key?.startsWith('/') || !cert?.startsWith('/')) throw Error('Set a private IPv4 address, port 1024-65535, and absolute TLS key and certificate paths');
 createLanGateway({address,port,key:readFileSync(key),cert:readFileSync(cert)}).listen(port,address,()=>console.log(`Staf HTTPS gateway listening on https://${address}:${port}`));
}
