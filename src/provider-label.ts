export function providerLabel(provider: string): string {
  return provider === 'codex' ? 'ChatGPT' : provider;
}

export function providerId(input: string): string {
  const value = input.toLowerCase();
  return value === 'chatgpt' ? 'codex' : value;
}
