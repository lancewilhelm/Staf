export type CredentialTransitionStage='attached'|'begun'|'grants-revoked'|'secret-config-written'|'first-secret-written'|'credentials-written'|'plugin-config-written'|'before-commit'|'after-commit'|'setup-socket-started'|'recovery-disabled';

export class CredentialTransitionFailed extends Error {
 constructor(){super('Connection was not changed. Review the connection and try again.');}
}

export class CredentialTransitionUncertain extends Error {
 constructor(){super('Connection outcome is uncertain. Restart Staf and review the connection before continuing.');}
}
