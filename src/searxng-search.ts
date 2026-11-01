import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';

export type SearchResult = Readonly<{ title: string; url: string; snippet: string }>;
export type SearchResults = Readonly<{ results: readonly SearchResult[]; truncated: boolean }>;
export type SearchResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: AsyncIterable<Uint8Array>;
  close: () => void;
}>;
/** Injection is for synthetic tests; production must use the fixed transport. */
export type SearchTransport = (input: Readonly<{ origin: string; body: string; signal: AbortSignal }>) => Promise<SearchResponse>;

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RESULTS = 10;
const MAX_RETURNED_RESULTS = 200;

export function checkedSearchOrigin(origin: string): string {
  if (typeof origin !== 'string') throw new Error('Invalid search backend');
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
  if (!match || !match[1] || Number(match[1]) > 65535) throw new Error('Invalid search backend');
  return `http://127.0.0.1:${Number(match[1])}`;
}
export function checkedSearchQuery(query: string): string {
  // SearXNG uses ! for engines, categories and redirects, and : for language.
  // This intentionally narrow character set also disallows encoded operators.
  if (typeof query !== 'string' || !query.trim() || Buffer.byteLength(query, 'utf8') > 1024 ||
      !/^[\p{L}\p{N} ',.\-]+$/u.test(query)) throw new Error('Invalid search query');
  return query;
}
function resultUrl(value: unknown): string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 2048 ||
      /[\s\\?#]/u.test(value)) throw new Error('Invalid search result URL');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid search result URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !url.hostname.includes('.') || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
      isIP(url.hostname) !== 0) throw new Error('Invalid search result URL');
  return url.href;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function parseResults(value: unknown): SearchResults {
  if (!record(value) || !Array.isArray(value.results) || value.results.length > MAX_RETURNED_RESULTS) {
    throw new Error('Invalid search response');
  }
  const results: SearchResult[] = [];
  for (const item of value.results) {
    if (!record(item) || typeof item.title !== 'string' || !item.title.trim() ||
        Buffer.byteLength(item.title, 'utf8') > 500 || typeof item.content !== 'string' ||
        Buffer.byteLength(item.content, 'utf8') > 2048) throw new Error('Invalid search response');
    const url = resultUrl(item.url);
    if (results.length < MAX_RESULTS) results.push({ title: item.title, url, snippet: item.content });
  }
  return { results, truncated: value.results.length > MAX_RESULTS };
}
const localTransport: SearchTransport = ({ origin, body, signal }) => new Promise((resolve, reject) => {
  const url = new URL('/search', origin);
  const request = httpRequest(url, {
    method: 'POST', agent: false, signal,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body),
      accept: 'application/json', 'accept-encoding': 'identity' },
  }, response => {
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(response.headers)) headers[key] = Array.isArray(value) ? value.join(', ') : value;
    resolve({ status: response.statusCode ?? 0, headers, body: response, close: () => response.destroy() });
  });
  request.once('error', reject);
  request.end(body);
});
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Search cancelled')); return; }
    const abort = () => reject(new Error('Search cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
/**
 * Search only an owner-configured localhost SearXNG service. Only trusted host
 * configuration may supply the origin; only tests should inject a transport.
 * This module does not perform authorization, rate limiting, logging, or result-page fetching.
 * Queries and returned text can be retained by the backend and upstreams.
 */
export async function searchSearxng(input: Readonly<{ origin: string; query: string; signal?: AbortSignal; timeoutMs?: number }>,
  transport: SearchTransport = localTransport): Promise<SearchResults> {
  const origin = checkedSearchOrigin(input.origin), query = checkedSearchQuery(input.query), timeoutMs = input.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw new Error('Invalid search timeout');
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  if (signal.aborted) throw new Error('Search cancelled');
  const body = new URLSearchParams({ q: query, format: 'json' }).toString();
  let response: SearchResponse;
  try {
    const pending = transport({ origin, body, signal }).then(value => { if (signal.aborted) value.close(); return value; });
    response = await abortable(pending, signal);
  } catch { throw new Error('Search request failed or was cancelled'); }
  try {
    const contentType = response.headers['content-type'] ?? '';
    const encoding = response.headers['content-encoding']?.trim().toLowerCase();
    if (response.status !== 200 || !/^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?\s*)?$/i.test(contentType.trim()) ||
        (encoding && encoding !== 'identity')) throw new Error('Unsupported search response');
    const bytes = Buffer.allocUnsafe(MAX_RESPONSE_BYTES);
    let size = 0;
    let chunksSinceYield = 0;
    const iterator = response.body[Symbol.asyncIterator]();
    while (true) {
      let item: IteratorResult<Uint8Array>;
      try { item = await abortable(iterator.next(), signal); }
      catch { throw new Error('Search response interrupted'); }
      if (item.done) break;
      if (!(item.value instanceof Uint8Array) || item.value.byteLength === 0) throw new Error('Invalid search response chunk');
      if (item.value.byteLength > MAX_RESPONSE_BYTES - size) throw new Error('Search response exceeds limit');
      bytes.set(item.value, size);
      size += item.value.byteLength;
      // Async iterators can resolve immediately. Yield to timers and cancellation
      // even if a backend sends a continuous stream of one-byte chunks.
      if (++chunksSinceYield === 64) {
        chunksSinceYield = 0;
        await new Promise<void>(resolve => setImmediate(resolve));
        if (signal.aborted) throw new Error('Search cancelled');
      }
    }
    if (signal.aborted) throw new Error('Search cancelled');
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))); }
    catch { throw new Error('Invalid search response'); }
    return parseResults(value);
  } finally { response.close(); }
}
