import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,ftruncateSync,openSync,opendirSync,readFileSync,readSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const integer=(value,min,max)=>{if(!Number.isSafeInteger(value)||value<min||value>max)throw Error('Invalid file request');return value;};
function boundedBytes(fd) {
 const stat=fstatSync(fd);if(!stat.isFile()||stat.size>1048576)throw Error('Not a bounded regular file');
 const buffer=Buffer.alloc(1048577);let count=0;while(count<buffer.length){const n=readSync(fd,buffer,count,buffer.length-count,count);if(!n)break;count+=n;}
 if(count>1048576)throw Error('File too large');return buffer.subarray(0,count);
}
/** Production receives fd 3 from the openat2 helper; it never resolves a request path. */
export function executeOpenedFileOperation(fd,request,directoryPath='/proc/self/fd/3') {
 if(!request||typeof request!=='object'||Array.isArray(request))throw Error('Invalid file request');
 const {kind}=request;
 if(kind==='read') {
  const offset=integer(request.offset,0,Number.MAX_SAFE_INTEGER),limit=integer(request.limit,1,32768),overlap=integer(request.overlap,0,65536),stat=fstatSync(fd);
  if(!stat.isFile())throw Error('Not a regular file');const padding=overlap+4,start=Math.max(0,offset-Math.max(65536,padding)),index=offset-start;
  const buffer=Buffer.alloc(index+limit+padding),count=readSync(fd,buffer,0,buffer.length,start);let sha256=null;
  if(stat.size<=1048576){const all=Buffer.alloc(stat.size+1),n=readSync(fd,all,0,all.length,0);if(n===stat.size)sha256=hash(all.subarray(0,n));}
  return {data:buffer.subarray(0,count).toString('base64'),start,index,size:stat.size,sha256};
 }
 if(kind==='write') {
  if(typeof request.content!=='string'||request.content.length>131072||!fstatSync(fd).isFile())throw Error('Invalid content');
  ftruncateSync(fd,0);writeFileSync(fd,request.content,'utf8');return {bytes:Buffer.byteLength(request.content),sha256:hash(Buffer.from(request.content))};
 }
 if(kind==='edit'||kind==='verify') {
  if(typeof request.sha256!=='string' && kind==='verify' || typeof request.expectedHash!=='string' && kind==='edit')throw Error('Invalid hash');
  const original=boundedBytes(fd),expected=kind==='edit'?request.expectedHash:request.sha256;if(kind==='verify')return {matches:hash(original)===expected};
  if(hash(original)!==expected)throw Error('Edit conflict');if(typeof request.oldText!=='string'||!request.oldText||request.oldText.length>65536||typeof request.newText!=='string'||request.newText.length>65536)throw Error('Invalid edit');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(original),at=text.indexOf(request.oldText);if(at<0||text.indexOf(request.oldText,at+1)>=0)throw Error('Edit requires one match');
  const updated=text.slice(0,at)+request.newText+text.slice(at+request.oldText.length);if(hash(boundedBytes(fd))!==expected)throw Error('Edit conflict');
  ftruncateSync(fd,0);writeFileSync(fd,updated,'utf8');return {bytes:Buffer.byteLength(updated),sha256:hash(Buffer.from(updated)),replacements:1};
 }
 if(kind==='search') {
  if(typeof request.query!=='string'||!request.query||request.query.length>1024)throw Error('Invalid query');
  const offset=integer(request.offset,0,Number.MAX_SAFE_INTEGER),limit=integer(request.limit,1,100),stat=fstatSync(fd);
  if(stat.isDirectory()){const names=[],dir=opendirSync(directoryPath);try{for(let entry=dir.readSync();entry;entry=dir.readSync()){names.push(entry.name);if(names.length>10000)throw Error('Directory too large');}}finally{dir.closeSync();}names.sort();const matches=names.filter(name=>name.includes(request.query)),page=matches.slice(offset,offset+limit);return {kind:'names',matches:page,offset,nextOffset:offset+page.length<matches.length?offset+page.length:null};}
  if(!stat.isFile())throw Error('Not a regular file');
  const needle=Buffer.from(request.query),size=Math.min(65536,Math.max(0,stat.size-offset)),buffer=Buffer.alloc(size),count=readSync(fd,buffer,0,size,offset),matches=[];let at=0;while(at<count){const found=buffer.indexOf(needle,at);if(found<0)break;matches.push(offset+found);at=found+1;if(matches.length===limit)break;}const next=matches.length===limit?matches[matches.length-1]+1:offset+Math.max(0,count-needle.length+1);return {kind:'content',matches,offset,scannedBytes:count,size:stat.size,nextOffset:next<stat.size && count===65536?next:matches.length===limit && next<stat.size?next:null};
 }
 throw Error('Unknown file request');
}

/** Local tests exercise worker behavior; production uses the openat2 helper. */
export function executeFileOperation(root,request) {
 if(!request||typeof request.path!=='string'||!request.path||request.path.includes('\0')||isAbsolute(request.path))throw Error('Invalid file path');
 const base=realpathSync(root),path=resolve(base,request.path),part=relative(base,path);
 if(part==='..'||part.startsWith('..'+sep)||isAbsolute(part))throw Error('Outside workspace');
 const actual=request.kind==='write'?realpathSync(dirname(path)):realpathSync(path),actualPart=relative(base,actual);
 if(actualPart==='..'||actualPart.startsWith('..'+sep)||isAbsolute(actualPart))throw Error('Outside workspace');
 const flags=(request.kind==='write'?constants.O_WRONLY|constants.O_CREAT:request.kind==='edit'?constants.O_RDWR:constants.O_RDONLY)|constants.O_NONBLOCK|constants.O_NOFOLLOW;
 const fd=openSync(path,flags,0o666);try{return executeOpenedFileOperation(fd,request,path);}finally{closeSync(fd);}
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {const raw=readFileSync(0,'utf8');if(Buffer.byteLength(raw)>1048576)throw Error('Request too large');const result=executeOpenedFileOperation(3,JSON.parse(raw));process.stdout.write(JSON.stringify({ok:true,result}));}
 catch {process.stdout.write(JSON.stringify({ok:false,error:'Isolated file operation failed'}));process.exitCode=1;}
}
