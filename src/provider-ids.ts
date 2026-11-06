/** Providers available for new selections and execution. Historical config may name others. */
export const providerIds = ['codex','openrouter','lmstudio','live'] as const;
export function isProviderId(value:string): boolean { return providerIds.some(provider=>provider===value); }
