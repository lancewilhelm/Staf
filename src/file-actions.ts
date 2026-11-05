import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, ftruncateSync, openSync, opendirSync, readSync, statSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {ActionFailed, type Capability, type WorkContext} from './work-actions.js';

const pathSchema=z.string().min(1).max(4096).refine(value=>!value.includes('\0'));
const offset=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0);
const limit=z.number().int().min(1).max(32768).default(8192);
const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const readInput=z.strictObject({path:pathSchema,offset,limit});
const writeInput=z.strictObject({path:pathSchema,content:z.string().max(131072)});
const editInput=z.strictObject({path:pathSchema,expectedHash:z.string().regex(/^[a-f0-9]{64}$/),oldText:z.string().min(1).max(65536),newText:z.string().max(65536)});
const searchInput=z.strictObject({path:pathSchema,query:z.string().min(1).max(1024),offset,limit:z.number().int().min(1).max(100).default(50)});
const result=z.json();
const filename=(work:WorkContext,path:string)=>resolve(work.workingDirectory,path);
function fail(error:unknown):never {
 if(error instanceof ActionFailed)throw error;
 if(error instanceof Error && 'code' in error && typeof error.code==='string')throw new ActionFailed(`File I/O error: ${error.code}`);
 throw error;
}
function safeInput<T>(schema:z.ZodType<T>,value:unknown,redact:(value:string)=>string):T {
 const parsed=schema.parse(value);
 const safe=(item:unknown):boolean=>typeof item==='string'?redact(item)===item:Array.isArray(item)?item.every(safe):item!==null && typeof item==='object'?Object.entries(item).every(([key,value])=>redact(key)===key && safe(value)):true;
 if(!safe(parsed))throw new ActionFailed('Input cannot be retained safely');
 return parsed;
}
function boundedHash(fd:number,size:number):string|null {const bytes=Buffer.alloc(size+1);const count=readSync(fd,bytes,0,bytes.length,0);return count===size?hash(bytes.subarray(0,count)):null;}
function editBytes(fd:number):Buffer {const stat=fstatSync(fd);if(!stat.isFile())throw new ActionFailed('Path is not a regular file');if(stat.size>1048576)throw new ActionFailed('Edit file exceeds 1 MiB');const buffer=Buffer.alloc(1048577);let count=0;while(count<buffer.length){const read=readSync(fd,buffer,count,buffer.length-count,count);if(!read)break;count+=read;}if(count>1048576)throw new ActionFailed('Edit file exceeds 1 MiB');return buffer.subarray(0,count);}
function definition(name:string,description:string,properties:Record<string,{type:string;description?:string;minimum?:number;maximum?:number}>,required:string[]) {return {type:'function' as const,function:{name,description,parameters:{type:'object' as const,properties,required,additionalProperties:false as const}}};}
const pathProp={type:'string',description:'Relative to the captured working folder or an absolute host path.'};
const numberProp={type:'integer',minimum:0};
function base<I extends {path:string}>(name:string,definitionValue:ReturnType<typeof definition>,schema:z.ZodType<I>,effect:'read'|'change',redact:(value:string)=>string,allowed:(work:WorkContext)=>boolean,execute:(input:I,work:WorkContext)=>Promise<unknown>):Capability<I,z.infer<typeof result>> {
 return {name,definition:definitionValue,parseInput:value=>safeInput(schema,value,redact),parseResult:value=>result.parse(value),eligible:allowed,check:(_input,work)=>{if(!allowed(work))throw Error('File action is no longer authorized');},authorize:async()=>{},describe:(input,work)=>({summary:`${name} ${filename(work,input.path)}`,resource:filename(work,input.path),effect}),execute:async (input,work)=>result.parse(await execute(input,work)),visibleResult:()=>`${name} completed`};
}
export function fileCapabilities(redact:(value:string)=>string,allowed:(work:WorkContext)=>boolean,readOverlap:()=>number) {
 const read=base('file_read',definition('file_read','Read a bounded page of actual file bytes, returned as base64. Follow nextOffset for more.',{path:pathProp,offset:numberProp,limit:{type:'integer',minimum:1,maximum:32768}},['path']),readInput,'read',redact,allowed,async(input,work)=>{
  try {const path=filename(work,input.path),fd=openSync(path,constants.O_RDONLY|constants.O_NONBLOCK);try {const stat=fstatSync(fd);if(!stat.isFile())throw new ActionFailed('Path is not a regular file');const overlap=readOverlap()+4,start=Math.max(0,input.offset-overlap),buffer=Buffer.alloc(input.limit+2*overlap);const count=readSync(fd,buffer,0,buffer.length,start);const text=buffer.subarray(0,count).toString('utf8');if(redact(text)!==text)throw new ActionFailed('File page cannot be retained safely');const page=buffer.subarray(input.offset-start,Math.min(count,input.offset-start+input.limit)),end=input.offset+page.length;return {path,encoding:'base64',data:page.toString('base64'),offset:input.offset,bytes:page.length,size:stat.size,nextOffset:end<stat.size?end:null,sha256:stat.size<=1048576?boundedHash(fd,stat.size):null};}finally {closeSync(fd);}}catch(error){return fail(error);}
 });
 const write=base('file_write',definition('file_write','Create or replace a UTF-8 file. Parent directory must exist.',{path:pathProp,content:{type:'string'}},['path','content']),writeInput,'change',redact,allowed,async(input,work)=>{
  const path=filename(work,input.path);work.signal.throwIfAborted();let fd:number;try {fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_NONBLOCK,0o666);}catch(error){return fail(error);}try {if(!fstatSync(fd).isFile())throw new ActionFailed('Path is not a regular file');ftruncateSync(fd,0);writeFileSync(fd,input.content,'utf8');return {path,bytes:Buffer.byteLength(input.content),sha256:hash(Buffer.from(input.content))};}finally {closeSync(fd);}
 });
 write.recovery={reconcile:(input,evidence,work)=>{
  const parsed=z.strictObject({sha256:z.string().regex(/^[a-f0-9]{64}$/)}).safeParse(evidence);
  if(!parsed.success || parsed.data.sha256!==hash(Buffer.from(input.content)))return false;
  try {const fd=openSync(filename(work,input.path),constants.O_RDONLY|constants.O_NONBLOCK);try{return hash(editBytes(fd))===parsed.data.sha256;}finally{closeSync(fd);}}catch{return false;}
 }};
 const edit=base('file_edit',definition('file_edit','Replace one unique UTF-8 text match in a file using its sha256 from file_read. Files must be at most 1 MiB.',{path:pathProp,expectedHash:{type:'string'},oldText:{type:'string'},newText:{type:'string'}},['path','expectedHash','oldText','newText']),editInput,'change',redact,allowed,async(input,work)=>{
  const path=filename(work,input.path);let bytes:Buffer;
  try {const fd=openSync(path,constants.O_RDONLY|constants.O_NONBLOCK);try {bytes=editBytes(fd);}finally {closeSync(fd);}}catch(error){return fail(error);}
  if(hash(bytes)!==input.expectedHash)throw new ActionFailed('Edit conflict: file hash changed');
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch {throw new ActionFailed('Edit requires valid UTF-8');}
  const index=text.indexOf(input.oldText);if(index<0)throw new ActionFailed('Edit failed: text not found');if(text.indexOf(input.oldText,index+1)>=0)throw new ActionFailed('Edit failed: text occurs more than once');
  const updated=text.slice(0,index)+input.newText+text.slice(index+input.oldText.length);
  try {work.signal.throwIfAborted();const fd=openSync(path,constants.O_RDWR|constants.O_NONBLOCK);try {if(hash(editBytes(fd))!==input.expectedHash)throw new ActionFailed('Edit conflict: file hash changed');ftruncateSync(fd,0);writeFileSync(fd,updated,'utf8');}finally {closeSync(fd);}return {path,bytes:Buffer.byteLength(updated),sha256:hash(Buffer.from(updated)),replacements:1};}catch(error){if(error instanceof ActionFailed)throw error;throw error;}
 });
 const search=base('file_search',definition('file_search','Search file bytes for literal UTF-8 text or list matching names in one directory. Use nextOffset to continue.',{path:pathProp,query:{type:'string'},offset:numberProp,limit:{type:'integer',minimum:1,maximum:100}},['path','query']),searchInput,'read',redact,allowed,async(input,work)=>{
  const path=filename(work,input.path);try {const stat=statSync(path);if(stat.isDirectory()){const names:string[]=[];const directory=opendirSync(path);try {for(let entry=directory.readSync();entry;entry=directory.readSync()){names.push(entry.name);if(names.length>10000)throw new ActionFailed('Directory exceeds 10000 entries; search a narrower path');}}finally {directory.closeSync();}names.sort();const matches=names.filter(name=>name.includes(input.query));const page=matches.slice(input.offset,input.offset+input.limit);return {path,kind:'names',matches:page,offset:input.offset,nextOffset:input.offset+page.length<matches.length?input.offset+page.length:null};}
   if(!stat.isFile())throw new ActionFailed('Path is not a regular file or directory');const fd=openSync(path,constants.O_RDONLY|constants.O_NONBLOCK);try {const needle=Buffer.from(input.query),size=Math.min(65536,Math.max(0,stat.size-input.offset));const buffer=Buffer.alloc(size);const count=readSync(fd,buffer,0,size,input.offset);const matches:number[]=[];let at=0;while(at<count){const found=buffer.indexOf(needle,at);if(found<0)break;matches.push(input.offset+found);at=found+1;if(matches.length===input.limit)break;}const next=matches.length===input.limit?matches[matches.length-1]!+1:input.offset+Math.max(0,count-needle.length+1);return {path,kind:'content',matches,offset:input.offset,scannedBytes:count,size:stat.size,nextOffset:next<stat.size && count===65536?next:matches.length===input.limit && next<stat.size?next:null};}finally {closeSync(fd);}
  }catch(error){return fail(error);}
 });
 return {read,write,edit,search};
}
