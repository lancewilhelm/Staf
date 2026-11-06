// Internal deterministic provider for offline tests only.
export const demoProvider = {
  name: 'demo',
  capabilities: { toolCalls: true, incrementalText: false, transport: 'demo' },
  async complete(messages, _tools, options) {
    const last = messages.at(-1);
    if (!last) throw new Error('Demo requires a message');
    if (last.role === 'tool') return { role: 'assistant', content: `Demo tool result: ${last.content}` };
    const current = options?.currentUserInput ?? last.content ?? '';
    if (/\btime\b/i.test(current)) return {
      role: 'assistant', content: null,
      tool_calls: [{ id: 'clock-demo', type: 'function', function: { name: 'clock', arguments: '{}' } }],
    };
    return { role: 'assistant', content: `Demo (offline): ${current}. User turns saved: ${messages.filter(m => m.role === 'user').length}. Ask "what time is it?" to see a tool call.` };
  },
};

