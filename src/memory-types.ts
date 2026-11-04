export type MemoryScope = { kind: 'user' } | { kind: 'bot'; botId: string };
export type Memory = { id: string; scope: MemoryScope; text: string; version: number; createdAt: string; updatedAt: string };
