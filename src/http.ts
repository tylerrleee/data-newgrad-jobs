export const USER_AGENT = "jobbo/0.1 (personal new-grad job alerts)";
const MAX_REDIRECTS = 5;

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(`${url}: HTTP ${status}`);
  }
}

/** The server answered a Range request with the whole file. */
export class RangeIgnoredError extends Error {}

export interface GetOptions {
  /** Sent verbatim; servers key ETags by encoding, so each feed always sends the same value. */
  acceptEncoding: string;
  etag?: string;
  range?: string;
  timeoutMs: number;
  /** Set false for identity requests so a compressed body is reported rather than mangled. */
  decompress?: boolean;
}

export type GetResult =
  | { status: 304 }
  | { status: 200 | 206; body: string; etag: string | undefined; contentRange: string | undefined };

function retryAfter(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - now) / 1000);
}

/**
 * Where a redirect link leads: hops on its own site are followed, and the first address on another
 * site is returned without being requested. A link that ends on a page of its own site returns
 * that page's address.
 */
export async function redirectTarget(url: string, timeoutMs: number): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  const requested = new URL(url);
  for (let target = requested, hops = 0; hops <= MAX_REDIRECTS; hops++) {
    const response = await fetch(target, { headers: { "User-Agent": USER_AGENT }, signal, redirect: "manual" });
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status <= 399 && location) {
      target = new URL(location, target);
      if (target.origin !== requested.origin) return target.href;
    } else if (response.ok) {
      return target.href;
    } else {
      throw new HttpError(target.href, response.status, retryAfter(response.headers.get("retry-after"), Date.now()));
    }
  }
  throw new Error(`${url}: more than ${MAX_REDIRECTS} redirects`);
}

export async function get(url: string, options: GetOptions): Promise<GetResult> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept-Encoding": options.acceptEncoding,
  };
  if (options.etag) headers["If-None-Match"] = options.etag;
  if (options.range) headers.Range = options.range;

  const signal = AbortSignal.timeout(options.timeoutMs);
  const requested = new URL(url);
  let response: Response;
  // Redirects are followed by hand so a request never reaches another site or a disallowed path.
  for (let target = requested, hops = 0; ; hops++) {
    response = await fetch(target, { headers, signal, decompress: options.decompress ?? true, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status > 399 || response.status === 304 || !location) break;
    await response.body?.cancel();
    target = new URL(location, target);
    const disallowed = target.pathname.startsWith("/api/") && !requested.pathname.startsWith("/api/");
    if (target.origin !== requested.origin || disallowed || hops >= MAX_REDIRECTS) {
      throw new Error(`${url}: redirected to ${target.href}; not following`);
    }
  }
  if (response.status === 304) return { status: 304 };
  if (response.status === 200 && options.range) {
    await response.body?.cancel();
    throw new RangeIgnoredError(`${url}: server ignored Range and sent the whole file`);
  }
  if (response.status !== 200 && response.status !== 206) {
    await response.body?.cancel();
    throw new HttpError(url, response.status, retryAfter(response.headers.get("retry-after"), Date.now()));
  }
  const encoding = response.headers.get("content-encoding");
  if (options.decompress === false && encoding && encoding !== "identity") {
    await response.body?.cancel();
    throw new Error(`${url}: asked for identity but got ${encoding}`);
  }
  return {
    status: response.status,
    body: await response.text(),
    etag: response.headers.get("etag") ?? undefined,
    contentRange: response.headers.get("content-range") ?? undefined,
  };
}
