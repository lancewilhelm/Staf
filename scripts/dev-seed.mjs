import { join } from 'node:path';
import { Instance } from '../dist/instance.js';

// Reset starts an unconfigured instance. Owners choose their own provider and model.
export function seed(root) {
  const instance=new Instance(join(root,'instance.sqlite'));
  instance.close();
}
