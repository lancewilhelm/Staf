import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

// Create a retained historical configuration without exposing new Demo selection.
export function legacyDemo(instance,name,instructions='') {
 const created=instance.createBot({name,instructions,provider:'lmstudio',model:'legacy-fixture'});
 const file=join(created.configDir,'agent.toml');
 writeFileSync(file,readFileSync(file,'utf8').replace('provider = "lmstudio"','provider = "demo"').replace('model = "legacy-fixture"\n',''));
 return instance.bot(created.id);
}
