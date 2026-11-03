#!/usr/bin/env node
import { errorMessage } from './validation.js';
import { cleanText } from './terminal-view.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === '__terminal-daemon') { const { terminalDaemon } = await import('./terminal-instance.js'); await terminalDaemon(args[1] || '.staf'); return; }
  if (args[0] === 'instance') { const { instanceCommand } = await import('./instance-cli.js'); await instanceCommand(args.slice(1)); return; }
  if (args.includes('--help') || args[0] === 'help') {
    console.log('Usage: staf [--data-dir PATH] [--instance URL --credential FILE]\n       staf instance help\n       staf settings show|defaults|set|set-default ...\n       staf auth chatgpt login|status|cancel|logout\nThe default opens the shared main chat. Use /help for chat commands.'); return;
  }
  const { terminalClient } = await import('./terminal-instance.js');
  await terminalClient(args);
}
main().catch((error: unknown) => { console.error(cleanText(`Staf: ${errorMessage(error)}`)); process.exitCode = 1; });
