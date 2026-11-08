import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { hasCode } from './validation.js';

function directory({root,create}:{root:string;create:boolean}):string {
  const base=resolve(root), dir=join(base,'auth');
  for(const path of [base,dir]) {
    if(create) mkdirSync(path,{recursive:true,mode:0o700});
    const stat=lstatSync(path);
    if(!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Unsafe credential directory');
  }
  return dir;
}
function pathFor({root,create}:{root:string;create:boolean}):string {return join(directory({root,create}),'slack.json');}
function validKey(key:unknown):key is string {return typeof key==='string' && key.length>0 && key.length<=4096 && /^[\x21-\x7e]+$/.test(key);}
export function loadSlackTokens(root:string):{appToken:string;botToken:string} | undefined {
  let fd:number | undefined;
  try {
    fd=openSync(pathFor({root,create:false}),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=lstatSync(pathFor({root,create:false}));
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size>8192) throw Error('Invalid credential');
    const raw:unknown=JSON.parse(readFileSync(fd,'utf8'));
    if(!raw || typeof raw!=='object' || !('appToken' in raw) || !validKey(raw.appToken) || !('botToken' in raw) || !validKey(raw.botToken)) throw Error('Invalid credential');
    return {appToken:raw.appToken,botToken:raw.botToken};
  } catch(error) {if(hasCode(error,'ENOENT')) return undefined;throw Error('Slack credential store unavailable');}
  finally {if(fd!==undefined)closeSync(fd);}
}
export function saveSlackTokens({root,appToken,botToken}:{root:string;appToken:unknown;botToken:unknown}):void {
  if(!validKey(appToken) || !validKey(botToken)) throw Error('Enter a nonempty Slack key without whitespace');
  const path=pathFor({root,create:true}), temp=path+'.'+randomUUID()+'.tmp';
  try {
    try {const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe credential destination');}catch(error){if(!hasCode(error,'ENOENT'))throw error;}
    const fd=openSync(temp,'wx',0o600);
    try {writeFileSync(fd,JSON.stringify({appToken,botToken})+'\n');fsyncSync(fd);}finally{closeSync(fd);}
    renameSync(temp,path);
  } finally {try{unlinkSync(temp);}catch(error){if(!hasCode(error,'ENOENT'))throw error;}}
}
export function disconnectSlackTokens(root:string):void {
  try {unlinkSync(pathFor({root,create:false}));}catch(error){if(!hasCode(error,'ENOENT'))throw Error('Slack credential store unavailable');}
}
