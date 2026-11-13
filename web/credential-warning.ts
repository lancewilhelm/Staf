/** Recognize a few distinctive credential formats without sending text to the service. */
export function containsCredential(text:string):boolean {
  return /(?:\bsk-(?:or-v1-|proj-)?[A-Za-z0-9_-]{16,}|\bxox[baprs]-[A-Za-z0-9-]{12,}|\bgh[pousr]_[A-Za-z0-9_]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bAIza[\w-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text);
}
