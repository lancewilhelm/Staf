import {startInstance as startService} from '../../dist/instance-service.js';
import {fileCapabilities} from '../../dist/file-actions.js';
import {tmpdir} from 'node:os';
import {demoProvider} from './echo-provider.mjs';

// Tests explicitly opt into the service injection boundary. No network fallback.
export function startInstance(path,port=0,options={}) {
  const providerFactory=options.providerFactory ?? (async profile=>{
    if(profile.model!=='fixture-offline') throw Error('No controlled provider configured for this fixture');
    return demoProvider;
  });
  return startService(path,port,{env:{},...options,providerFactory});
}

// Trusted synthetic tests only. This is service/protocol coverage, not isolation.
// Processes receive an explicit minimal environment and the fixture's commands
// and paths must use disposable data. No environment/API setting selects it.
export function startControlledInstance(path,port=0,options={}) {
  const providerFactory=options.providerFactory ?? (async profile=>{
    if(profile.model!=='fixture-offline')throw Error('No controlled provider configured for this fixture');
    return demoProvider;
  });
  const environment={PATH:process.env.PATH??'/usr/bin:/bin',HOME:tmpdir(),TMPDIR:tmpdir(),SHELL:'/bin/sh',TERM:'xterm-256color'};
  const hostWork={recheck(){},files:fileCapabilities,start:(manager,work,action,input)=>manager.start(work,action,input,environment)};
  const scratchExecutor=options.shellExecutor ?? (async()=>{throw Error('No synthetic scratch executor configured');});
  return startService(path,port,{env:{},...options,providerFactory},{hostWork,scratchExecutor});
}
