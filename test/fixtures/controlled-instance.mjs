import {startInstance as startService} from '../../dist/instance-service.js';
import {demoProvider} from './echo-provider.mjs';

// Tests explicitly opt into the service injection boundary. No network fallback.
export function startInstance(path,port=0,options={}) {
  const providerFactory=options.providerFactory ?? (async profile=>{
    if(profile.model!=='fixture-offline') throw Error('No controlled provider configured for this fixture');
    return demoProvider;
  });
  return startService(path,port,{env:{},...options,providerFactory});
}
