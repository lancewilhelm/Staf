import {closeSync,constants,fsyncSync,fstatSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {z} from 'zod';
import {hasCode} from './validation.js';

const token=z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/);
const schema=z.strictObject({email:z.email().max(320),clientId:token,clientSecret:token,refreshToken:token});
export type GmailCredential=z.infer<typeof schema>;
function pathFor(root:string,create:boolean) {
 const base=resolve(root),dir=join(base,'auth');
 for(const path of [base,dir]){if(create)mkdirSync(path,{recursive:true,mode:0o700});const stat=lstatSync(path);if(!stat.isDirectory() || stat.isSymbolicLink())throw Error('Unsafe credential directory');}
 return join(dir,'gmail.json');
}
export function loadGmailCredential(root:string):GmailCredential|undefined {
 let fd:number|undefined;
 try {fd=openSync(pathFor(root,false),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const stat=fstatSync(fd);if(!stat.isFile()||stat.size>20000)throw Error('Invalid credential');return schema.parse(JSON.parse(readFileSync(fd,'utf8')));}
 catch(error){if(hasCode(error,'ENOENT'))return undefined;throw Error('Gmail credential store unavailable');}
 finally {if(fd!==undefined)closeSync(fd);}
}
export function saveGmailCredential(root:string,input:GmailCredential):void {
 const value=schema.parse(input),path=pathFor(root,true),temp=path+'.'+randomUUID()+'.tmp';
 try {
  try {const stat=lstatSync(path);if(!stat.isFile() || stat.isSymbolicLink())throw Error('Unsafe credential destination');}catch(error){if(!hasCode(error,'ENOENT'))throw error;}
  const fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,path);
 } finally {try{unlinkSync(temp);}catch(error){if(!hasCode(error,'ENOENT'))throw error;}}
}
export function disconnectGmailCredential(root:string):void {try{unlinkSync(pathFor(root,false));}catch(error){if(!hasCode(error,'ENOENT'))throw Error('Gmail credential store unavailable');}}
