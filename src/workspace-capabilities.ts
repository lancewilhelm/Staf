import type {Instance} from './instance.js';
import {sessionCapabilities} from './session-capabilities.js';
import type {WorkspaceReference} from './workspace-reference-types.js';

export type WorkspaceScope = {botId:string;sessionId:string;commandId:string;signal:AbortSignal};

/** Application methods for registration by the Code Mode host and its action policy. */
export function workspaceCapabilities(instance:Instance, scope:WorkspaceScope) {
  const {botId,sessionId,commandId,signal}=scope;
  const captured={botId,sessionId,commandId,signal};
  function check() {
    signal.throwIfAborted();
    const command=instance.command(commandId),agent=instance.bot(botId);
    if(!agent||agent.archived||command?.botId!==botId||command.sessionId!==sessionId||command.state!=='pending'||instance.responseStopping(commandId))throw Error('Workspace work scope is no longer active.');
  }
  check();
  return {
    sessions:sessionCapabilities(instance,captured),
    documents:instance.documentCapabilities({...captured,check}),
    artifacts:instance.artifactCapabilities(captured),
    resolve(reference:WorkspaceReference){check();return instance.resolveWorkspaceReference(botId,reference);},
  };
}
