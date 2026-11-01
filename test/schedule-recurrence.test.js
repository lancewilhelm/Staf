import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRecurrence } from '../dist/schedule-recurrence.js';

const at = value => Date.parse(value);
const daily = (zone, hour, minute) => ({ kind: 'daily', timeZone: zone, hour, minute });
const run = (recurrence, cursor, now, maxLatenessMs = 0) => calculateRecurrence({ recurrence, cursor: at(cursor), now: at(now), maxLatenessMs });

test('daily latest-only catch-up, inclusive lateness, and cursor idempotency', () => {
  const rule = daily('UTC', 12, 0);
  const result = run(rule, '2024-02-27T12:00:00Z', '2024-03-01T12:05:00Z', 300_000);
  assert.deepEqual(result, { latestDue: at('2024-03-01T12:00:00Z'), eligible: true, nextDue: at('2024-03-02T12:00:00Z') });
  assert.equal(run(rule, '2024-02-27T12:00:00Z', '2024-03-01T12:05:00Z', 299_999).eligible, false);
  assert.deepEqual(run(rule, '2024-03-01T12:00:00Z', '2024-03-01T12:05:00Z'), { latestDue: null, eligible: false, nextDue: at('2024-03-02T12:00:00Z') });
  assert.equal(run(rule, '2024-02-28T12:00:00Z', '2024-02-29T12:00:00Z').latestDue, at('2024-02-29T12:00:00Z'));
});

test('weekly uses local weekday and crosses year boundaries', () => {
  const rule = { ...daily('UTC', 9, 15), kind: 'weekly', weekday: 1 };
  assert.deepEqual(run(rule, '2023-12-25T09:15:00Z', '2024-01-01T09:15:00Z'), { latestDue: at('2024-01-01T09:15:00Z'), eligible: true, nextDue: at('2024-01-08T09:15:00Z') });
});

test('New York spring gap is skipped and fall fold runs at first instant only', () => {
  const spring = daily('America/New_York', 2, 30);
  assert.deepEqual(run(spring, '2024-03-09T07:30:00Z', '2024-03-10T12:00:00Z'), { latestDue: null, eligible: false, nextDue: at('2024-03-11T06:30:00Z') });
  const fall = daily('America/New_York', 1, 30);
  assert.deepEqual(run(fall, '2024-11-02T05:30:00Z', '2024-11-03T06:30:00Z', 3_600_000), { latestDue: at('2024-11-03T05:30:00Z'), eligible: true, nextDue: at('2024-11-04T06:30:00Z') });
  assert.equal(run(fall, '2024-11-03T05:30:00Z', '2024-11-03T06:30:00Z').latestDue, null);
});

test('non-hour timezone and backward clock', () => {
  const rule = daily('Asia/Kathmandu', 8, 0);
  assert.equal(run(rule, '2024-01-01T02:15:00Z', '2024-01-02T02:15:00Z').latestDue, at('2024-01-02T02:15:00Z'));
  assert.deepEqual(run(rule, '2024-01-03T02:15:00Z', '2024-01-01T00:00:00Z'), { latestDue: null, eligible: false, nextDue: at('2024-01-04T02:15:00Z') });
});

test('invalid zone, time, weekday, bounds, and lateness are rejected', () => {
  for (const rule of [daily('Not/AZone', 12, 0), daily('UTC', 24, 0), daily('UTC', 0, 60), { ...daily('UTC', 1, 0), kind: 'weekly', weekday: 7 }]) {
    assert.throws(() => run(rule, '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z'), RangeError);
  }
  assert.throws(() => run(daily('UTC', 1, 0), '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z', -1), RangeError);
  assert.throws(() => run(daily('UTC', 1, 0), 'invalid', '2024-01-02T00:00:00Z'), RangeError);
});


test('last supported occurrence reports exhaustion and remains a valid cursor', () => {
  const rule = daily('UTC', 0, 0);
  const final = run(rule, '9996-12-30T00:00:00Z', '9996-12-31T00:00:00Z');
  assert.deepEqual(final, { latestDue: at('9996-12-31T00:00:00Z'), eligible: true, nextDue: null });
  assert.deepEqual(calculateRecurrence({ recurrence: rule, cursor: final.latestDue, now: at('9996-12-31T23:59:59Z'), maxLatenessMs: 0 }), { latestDue: null, eligible: false, nextDue: null });
});
