export function providerLabel(provider: string): string {
  const labels: Record<string, string> = {demo: 'Demo', codex: 'ChatGPT', openrouter: 'OpenRouter', lmstudio: 'LM Studio', live: 'HTTP'};
  return labels[provider] ?? provider;
}
