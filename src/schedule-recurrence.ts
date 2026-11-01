/** Provisional policy: skip nonexistent local times and choose the first instant in a fold. */
export type Recurrence =
  | { kind: 'daily'; timeZone: string; hour: number; minute: number }
  | { kind: 'weekly'; timeZone: string; hour: number; minute: number; weekday: number };

export interface RecurrenceResult {
  /** Latest occurrence strictly after cursor and at or before now. */
  latestDue: number | null;
  /** Whether latestDue is within the inclusive lateness window. */
  eligible: boolean;
  /** First occurrence strictly after both now and cursor, or null when the supported range ends. */
  nextDue: number | null;
}

const DAY = 86_400_000;
const MIN_INSTANT = Date.UTC(1971, 0, 1);
const MAX_INSTANT = Date.UTC(9997, 0, 1);

type LocalDate = { year: number; month: number; day: number };
type LocalDateTime = LocalDate & { hour: number; minute: number; second: number };

function localParts(formatter: Intl.DateTimeFormat, timestamp: number): LocalDateTime {
  const values = new Map(formatter.formatToParts(timestamp).map(part => [part.type, Number(part.value)]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  const hour = values.get('hour');
  const minute = values.get('minute');
  const second = values.get('second');
  if ([year, month, day, hour, minute, second].some(value => value === undefined)) {
    throw new RangeError('Could not resolve local time');
  }
  return { year: year!, month: month!, day: day!, hour: hour!, minute: minute!, second: second! };
}

function localEpoch(parts: LocalDateTime): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function dateAtOffset(date: LocalDate, offset: number): LocalDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day) + offset * DAY);
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function occurrence(formatter: Intl.DateTimeFormat, date: LocalDate, hour: number, minute: number): number | null {
  const target = { ...date, hour, minute, second: 0 };
  const nominal = localEpoch(target);
  const offsets = new Set<number>();
  // Sampling on both sides captures the offsets before and after a local transition.
  for (let shift = -3 * DAY; shift <= 3 * DAY; shift += 6 * 3_600_000) {
    const sample = nominal + shift;
    offsets.add(localEpoch(localParts(formatter, sample)) - sample);
  }
  let first: number | null = null;
  for (const offset of offsets) {
    const candidate = nominal - offset;
    if (localEpoch(localParts(formatter, candidate)) === nominal && (first === null || candidate < first)) {
      first = candidate;
    }
  }
  return first;
}

function validateInstant(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < MIN_INSTANT || value >= MAX_INSTANT) {
    throw new RangeError(`${name} must be an epoch millisecond within 1971 through 9996`);
  }
}

/**
 * Calculates at most one missed occurrence. The caller persists a consumed cursor
 * separately, including when latestDue is too old to execute. The result does not
 * enqueue work or provide concurrency control.
 */
export function calculateRecurrence(input: {
  recurrence: Recurrence;
  cursor: number;
  now: number;
  maxLatenessMs: number;
}): RecurrenceResult {
  const { recurrence, cursor, now, maxLatenessMs } = input;
  validateInstant(cursor, 'cursor');
  validateInstant(now, 'now');
  if (!Number.isSafeInteger(maxLatenessMs) || maxLatenessMs < 0) throw new RangeError('Invalid lateness');
  if (!Number.isInteger(recurrence.hour) || recurrence.hour < 0 || recurrence.hour > 23 ||
      !Number.isInteger(recurrence.minute) || recurrence.minute < 0 || recurrence.minute > 59) {
    throw new RangeError('Invalid local time');
  }
  if (recurrence.kind !== 'daily' && recurrence.kind !== 'weekly') throw new RangeError('Invalid recurrence');
  if (recurrence.kind === 'weekly' && (!Number.isInteger(recurrence.weekday) || recurrence.weekday < 0 || recurrence.weekday > 6)) {
    throw new RangeError('Invalid weekday');
  }
  if (typeof recurrence.timeZone !== 'string' || !recurrence.timeZone || /^[+-]/.test(recurrence.timeZone)) {
    throw new RangeError('Invalid IANA time zone');
  }
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: recurrence.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const matchesDay = (date: LocalDate): boolean => recurrence.kind === 'daily' ||
    new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() === recurrence.weekday;
  const find = (anchor: number, direction: -1 | 1, inclusive: boolean): number | null => {
    const date = localParts(formatter, anchor);
    for (let i = 0; i < 370; i++) {
      const candidateDate = dateAtOffset(date, i * direction);
      if (!matchesDay(candidateDate)) continue;
      const candidate = occurrence(formatter, candidateDate, recurrence.hour, recurrence.minute);
      if (candidate !== null && (direction === 1 ? candidate > anchor : inclusive ? candidate <= anchor : candidate < anchor)) {
        return candidate >= MIN_INSTANT && candidate < MAX_INSTANT ? candidate : null;
      }
    }
    throw new RangeError('Could not find an occurrence within 370 days');
  };
  const latest = now > cursor ? find(now, -1, true) : null;
  const latestDue = latest !== null && latest > cursor ? latest : null;
  return {
    latestDue,
    eligible: latestDue !== null && now - latestDue <= maxLatenessMs,
    nextDue: find(Math.max(now, cursor), 1, false)
  };
}
