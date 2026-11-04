import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Instance } from '../dist/instance.js';

// Synthetic conversations are definitions, not a captured database or provider responses.
const agents = [
  {name:'Project guide', instructions:'Help organize a small project. Be clear about assumptions.', turns:[
    ['What should we tackle first?', 'Start by agreeing on the outcome and the smallest useful milestone.'],
    ['We need a local workspace for notes.', 'A shared workspace with a search box and a short welcome page is a good first slice.'],
    ['What should the welcome page say?', 'Explain where notes live, how to add one, and who can see them.'],
    ['How can we test that?', 'Ask a new teammate to create and find a note without assistance.'],
    ['What risks remain?', 'Check backup and restore, then clarify what happens when two people edit at once.'],
    ['Write a short checklist.', 'Define the outcome, build the first slice, test the journey, and document recovery.']
  ]},
  {name:'Writing partner', instructions:'Help revise drafts without changing their meaning.', turns:[['Make this clearer: The work is proceeding.', 'The work is moving forward.']]},
  {name:'Fresh notebook', instructions:'Help explore new ideas.', turns:[]},
  {name:'Recovery example', instructions:'Explain errors and preserve work.', turns:[], failure:'A synthetic provider error for testing recovery.'}
];
export function seed(root) {
  const instance=new Instance(join(root,'instance.sqlite'));
  try {
    for (const definition of agents) {
      const bot=instance.createBot({name:definition.name,instructions:definition.instructions,provider:'demo'});
      for (const [content,answer] of definition.turns) {const id=randomUUID();instance.claim({id,botId:bot.id,content});instance.complete(id,answer);}
      if(definition.failure){const id=randomUUID();instance.claim({id,botId:bot.id,content:'Show a recoverable error.'});instance.fail(id,definition.failure);}
    }
  } finally {instance.close();}
}
