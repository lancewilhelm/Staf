export function providerLabel(provider: string): string {
  if (provider.startsWith('codex-direct:')) return 'ChatGPT' + provider.slice('codex-direct'.length);
  return provider === 'codex' ? 'ChatGPT' : provider;
}

export function providerId(input: string): string {
  const value = input.toLowerCase();
  return value === 'chatgpt' ? 'codex' : value;
}
