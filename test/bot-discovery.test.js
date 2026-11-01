import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverBots } from '../dist/bot-discovery.js';

const entries = [
  { id: 'self', name: 'Researcher', description: 'research', availability: 'active' },
  { id: 'b', name: 'Researcher', description: 'Research history', availability: 'busy' },
  { id: 'a', name: 'Researcher', description: 'Research history', availability: 'active' },
  { id: 'old', name: 'Researcher', description: 'research', availability: 'archived' },
  { id: 'c', name: 'Editor', description: 'Edits prose', availability: 'active' },
];
const search = (query, options = {}) => discoverBots({ requesterId: 'self', entries, query, ...options });

test('duplicates remain distinct and ambiguity survives result limits and busy state', () => {
  const result = search('research', { limit: 1 });
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.total, 2);
  assert.equal(result.candidates[0].id, 'a');
  assert.deepEqual(search('research').candidates.map(bot => [bot.id, bot.availability]), [['a', 'active'], ['b', 'busy']]);
});

test('returns matches, no matches and unclear requests without selecting a helper', () => {
  assert.equal(search('prose').kind, 'match');
  assert.equal(search('unknown').kind, 'no-match');
  assert.equal(search('').kind, 'ambiguous');
  assert.equal(search('!!!', { entries: [entries[4]] }).kind, 'ambiguous');
  assert.equal(search('research prose').kind, 'no-match');
});

test('only name and description participate and returned entries contain no hidden fields', () => {
  const extra = [{ ...entries[4], transcript: 'secretword', memory: 'hiddenword' }];
  assert.equal(search('secretword', { entries: extra }).kind, 'no-match');
  assert.equal(search('hiddenword', { entries: extra }).kind, 'no-match');
  assert.deepEqual(Object.keys(search('editor', { entries: extra }).candidates[0]).sort(), ['availability', 'description', 'id', 'name']);
  assert.equal(search('self').kind, 'no-match');
});

test('normalizes Unicode and gives stable ordering independent of input order', () => {
  const unicode = [{ id: 'z', name: 'CAFÉ', description: '', availability: 'active' }, { id: 'a', name: 'Cafe\u0301', description: '', availability: 'busy' }];
  assert.deepEqual(search('cafe\u0301', { entries: unicode }).candidates.map(bot => bot.id), ['a', 'z']);
  assert.deepEqual(search('café', { entries: unicode.reverse() }).candidates.map(bot => bot.id), ['a', 'z']);
});

test('rejects invalid or excessive input and duplicate IDs', () => {
  assert.throws(() => search('x', { limit: 0 }), /limit/);
  assert.throws(() => search('x', { limit: 101 }), /limit/);
  assert.throws(() => search('x'.repeat(1025)), /query/);
  assert.throws(() => search('x', { entries: Array(1001).fill(entries[0]) }), /entries/);
  assert.throws(() => search('x', { entries: [entries[0], entries[0]] }), /Duplicate/);
  assert.throws(() => search('x', { entries: [{ ...entries[0], availability: 'unknown' }] }), /availability/);
});
