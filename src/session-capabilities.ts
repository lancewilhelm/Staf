import type { Instance } from './instance.js';
import type { SessionMessageReference } from './conversation-sessions.js';

/** Scoped service adapter for a future host bridge; this does not register model tools. */
export function sessionCapabilities(instance:Instance, scope:{botId:string;sessionId:string;commandId:string;signal:AbortSignal}) {
  const {botId,sessionId,commandId,signal}=scope;
  function check() {
    signal.throwIfAborted();
    const command=instance.command(commandId);
    if(!command || command.botId!==botId || command.sessionId!==sessionId || command.state!=='pending' || instance.responseStopping(commandId) || instance.currentSession(botId).id!==sessionId)throw Error('Session capability no longer authorized');
  }
  return {
    current(){check();return instance.currentSession(botId);},
    list(offset=0,limit=100){check();return instance.listSessions(botId,offset,limit);},
    read(sessionId:string,offset=0,limit=100){check();return instance.readSession(botId,sessionId,offset,limit);},
    search(query:string){check();return instance.searchSessions(botId,query);},
    resolve(reference:SessionMessageReference){check();return instance.resolveSessionMessage(botId,reference);}
  };
}
