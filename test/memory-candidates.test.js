import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewMemoryCandidates } from '../dist/memory-candidates.js';

const entry = (id, text, scope = { kind: 'bot', botId: 'ada' }, version = 1) =>
  ({ id, text, scope, version, createdAt: '', updatedAt: '' });
const request = (entries, query = 'tea', limit = 10) => ({ botId: 'ada', query, entries, limit });

test('returns full exact-scope previews without ranking or selecting a target', () => {
  const entries = [entry('a', 'Green tea'), entry('b', 'Tea at noon', { kind: 'user' }, 3), entry('c', 'Coffee')];
  assert.deepEqual(previewMemoryCandidates(request(entries)).candidates, [
    { id: 'a', version: 1, scope: { kind: 'bot', botId: 'ada' }, text: 'Green tea' },
    { id: 'b', version: 3, scope: { kind: 'user' }, text: 'Tea at noon' },
  ]);
  assert.deepEqual(previewMemoryCandidates(request(entries, 'nothing')), { candidates: [], truncated: false });
  assert.equal(entries[0].text, 'Green tea');
});

test('bounds results and signals that other matching entries were omitted', () => {
  const entries = [entry('a', 'Tea first'), entry('b', 'Tea second'), entry('c', 'Tea third')];
  const result = previewMemoryCandidates(request(entries, 'tea', 2));
  assert.deepEqual(result.candidates.map((item) => item.id), ['a', 'b']);
  assert.equal(result.truncated, true);
  assert.deepEqual(previewMemoryCandidates(request(entries, 'tea second', 2)).truncated, false);
});

test('rejects foreign bots and unsupported exclusion arguments even beyond the result limit', () => {
  assert.throws(() => previewMemoryCandidates(request([entry('a', 'Tea'), entry('b', 'Tea', { kind: 'bot', botId: 'other' })], 'tea', 1)), /outside/);
  assert.throws(() => previewMemoryCandidates({ ...request([entry('a', 'Tea')]), exclude: ['b'] }), /Invalid/);
  assert.deepEqual(previewMemoryCandidates(request([entry('a', 'Tea except lemon')], 'except lemon')).candidates.map((item) => item.id), ['a']);
});

test('rejects invalid requests and ambiguous duplicate identifiers', () => {
  assert.throws(() => previewMemoryCandidates(request([], '  ')), /Invalid/);
  assert.throws(() => previewMemoryCandidates(request([], 'tea', 21)), /Invalid/);
  assert.throws(() => previewMemoryCandidates(request([entry('a', 'Tea'), entry('a', 'Tea', { kind: 'user' })])), /Invalid/);
  assert.throws(() => previewMemoryCandidates(request([entry('a', 'Tea', { kind: 'bot', botId: 'ada' }, 0)])), /Invalid/);
});
