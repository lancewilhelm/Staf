import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

export interface WebSource {
  requestedUrl: string;
  finalUrl: string;
  contentType: string;
  fetchedAt: string;
  text: string;
  truncated: boolean;
}

type Address = { address: string; family: 4 | 6 };
type Response = { status: number; headers: Record<string, string | undefined>; body: AsyncIterable<Uint8Array>; close: () => void };
export type Dependencies = {
  resolve: (hostname: string) => Promise<Address[]>;
  request: (url: URL, address: Address, signal: AbortSignal) => Promise<Response>;
};

// Conservative IPv4 exclusions; unsupported IPv6 fails closed.
function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    const [a, b, c] = octets;
    if (a === undefined || b === undefined || c === undefined) return false;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  // IPv6 allocation and transition ranges require a maintained registry;
  // reject all IPv6 until one is available rather than guess at publicness.
  return false;
}

export function checkedUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported or credential-bearing URL');
  url.hash = '';
  return url;
}

export function checkedOwnerWebUrl(value:string): URL {
  if(typeof value !== 'string' || Buffer.byteLength(value,'utf8') > 2048 || !value.trim()) throw Error('Invalid web URL');
  try {const url=checkedUrl(value);if(url.href.includes('?'))throw Error('Query strings are not supported');return url;}
  catch {throw Error('Web URL must be HTTP(S), at most 2048 bytes, with no credentials or query');}
}

export function containsUnsafeWebUrl(text:string): boolean {
  for(const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {try {const url=new URL(match[0]);if(url.username || url.password || url.href.includes('?'))return true;} catch {return true;}}
  return false;
}

const defaults: Dependencies = {
  async resolve(hostname) {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map(({ address, family }) => {
      if (family !== 4 && family !== 6) throw new Error('Unsupported DNS address family');
      return { address, family };
    });
  },
  request(url, address, signal) {
    return new Promise((resolve, reject) => {
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = send(url, {
        signal,
        agent: false,
        family: address.family,
        headers: { accept: 'text/plain, text/html', 'accept-encoding': 'identity' },
        lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      }, (res: IncomingMessage) => {
        const headers: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(res.headers)) headers[key] = Array.isArray(value) ? value.join(', ') : value;
        resolve({ status: res.statusCode ?? 0, headers, body: res, close: () => res.destroy() });
      });
      req.on('error', reject);
      req.end();
    });
  },
};

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

export async function readWebSource(input: string, options: { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number; maxRedirects?: number; dependencies?: Dependencies; runHop?: <T>(url: string, hop: number, read: () => Promise<T>) => Promise<T> } = {}): Promise<WebSource> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 3;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 10 * 1024 * 1024 || !Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5) throw new Error('Invalid reader limits');
  const deps = options.dependencies ?? defaults;
  let url = checkedUrl(input);
  const requestedUrl = url.href;
  for (let redirects = 0; ; redirects++) {
    options.signal?.throwIfAborted();
    const result = await (options.runHop ?? (async (_url, _hop, read) => read()))(url.href, redirects, async () => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    signal.throwIfAborted();
    const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
    const literalFamily = isIP(hostname);
    const addresses: Address[] = literalFamily === 4 || literalFamily === 6 ? [{ address: hostname, family: literalFamily }] : await abortable(deps.resolve(hostname), signal);
    if (addresses.some(a => isIP(a.address) !== a.family)) throw new Error('Invalid DNS address');
    // IPv6 is not used; select only IPv4 and never fall back to another family.
    const ipv4 = addresses.filter(a => a.family === 4);
    if (ipv4.length === 0 || ipv4.some(a => !publicAddress(a.address))) throw new Error('Destination is not a public address');
    const address = ipv4[0];
    if (!address) throw new Error('No destination address');
    const pendingResponse = deps.request(url, address, signal).then(response => {
      if (signal.aborted) response.close();
      return response;
    });
    const response = await abortable(pendingResponse, signal);
    try {
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= maxRedirects || !response.headers.location) throw new Error('Invalid or excessive redirect');
        return { kind: 'redirect' as const, url: checkedUrl(new URL(response.headers.location, url).href) };
      }
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP status ${response.status}`);
      const contentType = response.headers['content-type']?.trim() ?? '';
      if (!/^text\/(plain|html)(?:\s*;|\s*$)/i.test(contentType) || /charset\s*=\s*"?(?!utf-8(?:"|\s|;|$))/i.test(contentType)) throw new Error('Unsupported content type or charset');
      const encoding = response.headers['content-encoding']?.trim().toLowerCase();
      if (encoding && encoding !== 'identity') throw new Error('Unsupported content encoding');
      const bytes = Buffer.allocUnsafe(maxBytes);
      let size = 0;
      let truncated = false;
      const iterator = response.body[Symbol.asyncIterator]();
      while (true) {
        const item = await abortable(iterator.next(), signal);
        if (item.done) break;
        const remaining = maxBytes - size;
        if (item.value.byteLength > remaining) {
          bytes.set(item.value.subarray(0, remaining), size);
          size += remaining;
          truncated = true;
          break;
        }
        bytes.set(item.value, size);
        size += item.value.byteLength;
      }
      // A truncated UTF-8 sequence is omitted; malformed complete input fails.
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size), { stream: truncated });
      return { kind: 'source' as const, source: { requestedUrl, finalUrl: url.href, contentType, fetchedAt: new Date().toISOString(), text, truncated } };
    } finally { response.close(); }
    });
    if (result.kind === 'source') return result.source;
    url = result.url;
  }
}
