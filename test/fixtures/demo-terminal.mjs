import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Instance} from '../../dist/instance.js';

// Explicit legacy Demo fixture for terminal tests. Each root is disposable.
export function seedDemoTerminal(root) {
 mkdirSync(root,{recursive:true});const token='a'.repeat(43);
 writeFileSync(join(root,'terminal-credential.json'),JSON.stringify({token}),{mode:0o600});
 const instance=new Instance(join(root,'instance.sqlite'));
 try {instance.bootstrapLocal(token);const bot=instance.createBot({name:'Staf',instructions:'',provider:'demo'});instance.db.prepare('INSERT INTO main_bot VALUES (1,?)').run(bot.id);}
 finally {instance.close();}
}
if(process.argv[1]?.endsWith('/demo-terminal.mjs'))seedDemoTerminal(process.argv[2]);
