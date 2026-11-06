import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {Instance} from '../../dist/instance.js';

// Starts an explicitly controlled loopback provider and a disposable local dataset.
export function seedDemoTerminal(root) {
 mkdirSync(root,{recursive:true});const token='a'.repeat(43);
 writeFileSync(join(root,'terminal-credential.json'),JSON.stringify({token}),{mode:0o600});
 const instance=new Instance(join(root,'instance.sqlite'));
 try {instance.bootstrapLocal(token);const bot=instance.createBot({name:'Staf',instructions:'',provider:'live',model:'fixture-offline'});instance.db.prepare('INSERT INTO main_bot VALUES (1,?)').run(bot.id);}
 finally {instance.close();}
 const endpoint=join(root,'fixture-endpoint.json');
 const child=spawn(process.execPath,[new URL('./terminal-provider.mjs',import.meta.url).pathname,endpoint],{detached:true,stdio:'ignore'});child.unref();
 for(let i=0;i<500&&!existsSync(endpoint);i++)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
 if(!existsSync(endpoint)){child.kill('SIGTERM');throw Error('Controlled provider did not start');}
 return terminalFixtureEnv(root);
}
export function terminalFixtureEnv(root){const {port}=JSON.parse(readFileSync(join(root,'fixture-endpoint.json'),'utf8'));return {STAF_API_KEY:'synthetic-fixture-key',STAF_BASE_URL:`http://127.0.0.1:${port}/v1/`};}
export function stopTerminalFixture(root){try{process.kill(JSON.parse(readFileSync(join(root,'fixture-endpoint.json'),'utf8')).pid,'SIGTERM');}catch{}}
if(process.argv[1]?.endsWith('/demo-terminal.mjs'))console.log(JSON.stringify(seedDemoTerminal(process.argv[2])));
