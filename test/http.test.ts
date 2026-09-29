import { afterAll, describe, expect, test } from "bun:test";
import { get, HttpError, RangeIgnoredError, redirectTarget, USER_AGENT } from "../src/http.ts";

let lastHeaders = new Headers();
let endlessCancelled = false;

/** Streams chunks until the client goes away, so reading it to the end would hang the test. */
function endless(): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(64 * 1024).fill(120);
  return new ReadableStream({
    async pull(controller) {
      controller.enqueue(chunk);
      await Bun.sleep(1);
    },
    cancel() {
      endlessCancelled = true;
    },
  });
}

/** Sends headers and a first chunk, then never finishes the body. */
function stalled(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("partial"));
    },
    pull: () => new Promise<void>(() => {}),
  });
}

let otherRequests = 0;
let apiRequests = 0;
const other = Bun.serve({
  port: 0,
  fetch: () => {
    otherRequests++;
    return new Response("elsewhere");
  },
});

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    lastHeaders = request.headers;
    const { pathname } = new URL(request.url);
    switch (pathname) {
      case "/ok":
        return new Response("hello", { headers: { ETag: '"v1"' } });
      case "/conditional":
        return request.headers.get("if-none-match") === '"v1"'
          ? new Response(null, { status: 304, headers: { ETag: '"v1"' } })
          : new Response("fresh", { headers: { ETag: '"v1"' } });
      case "/tail":
        return new Response("0123456789", {
          status: 206,
          headers: { ETag: 'W/"v2"', "Content-Range": "bytes 90-99/100" },
        });
      case "/whole":
        return new Response(endless());
      case "/broken":
        return new Response("oops", { status: 500 });
      case "/limited":
        return new Response("slow down", { status: 429, headers: { "Retry-After": "120" } });
      case "/limited-date":
        return new Response("slow down", {
          status: 503,
          headers: { "Retry-After": new Date(Date.now() + 90_000).toUTCString() },
        });
      case "/limited-junk":
        return new Response("slow down", { status: 429, headers: { "Retry-After": "soon" } });
      case "/away":
        return Response.redirect(`${other.url}landing`, 302);
      case "/moved":
        return Response.redirect("/ok", 301);
      case "/link":
        return Response.redirect("/link/", 301);
      case "/link/":
        return Response.redirect(`${other.url}job?id=7`, 302);
      case "/loop":
        return Response.redirect("/loop", 302);
      case "/to-api":
        return Response.redirect("/api/jobs", 302);
      case "/api/jobs":
        apiRequests++;
        return new Response("[]");
      case "/slow-headers":
        await Bun.sleep(2_000);
        return new Response("late");
      case "/slow-body":
        return new Response(stalled());
      case "/gzip":
        return new Response(Bun.gzipSync(new TextEncoder().encode("squeezed")), {
          headers: { "Content-Encoding": "gzip" },
        });
      default:
        return new Response("not found", { status: 404 });
    }
  },
});

afterAll(() => {
  server.stop(true);
  other.stop(true);
});

const url = (path: string) => new URL(path, server.url).href;
const plain = { acceptEncoding: "gzip", timeoutMs: 5_000 };

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the request to fail");
}

describe("get: request headers", () => {
  test("sends the user agent, encoding, ETag and range verbatim", async () => {
    await get(url("/tail"), {
      acceptEncoding: "identity",
      etag: 'W/"abc"',
      range: "bytes=-262144",
      timeoutMs: 5_000,
      decompress: false,
    });
    expect(lastHeaders.get("user-agent")).toBe(USER_AGENT);
    expect(lastHeaders.get("accept-encoding")).toBe("identity");
    expect(lastHeaders.get("if-none-match")).toBe('W/"abc"');
    expect(lastHeaders.get("range")).toBe("bytes=-262144");
  });

  test("sends no If-None-Match or Range unless asked", async () => {
    await get(url("/ok"), { acceptEncoding: "br, gzip", timeoutMs: 5_000 });
    expect(lastHeaders.get("user-agent")).toBe(USER_AGENT);
    expect(lastHeaders.get("accept-encoding")).toBe("br, gzip");
    expect(lastHeaders.has("if-none-match")).toBe(false);
    expect(lastHeaders.has("range")).toBe(false);
  });
});

describe("get: responses", () => {
  test("200 returns the body and ETag", async () => {
    expect(await get(url("/ok"), plain)).toEqual({
      status: 200,
      body: "hello",
      etag: '"v1"',
      contentRange: undefined,
    });
  });

  test("304 when the ETag still matches", async () => {
    expect(await get(url("/conditional"), { ...plain, etag: '"v1"' })).toEqual({ status: 304 });
    expect(await get(url("/conditional"), { ...plain, etag: '"v0"' })).toMatchObject({ status: 200, body: "fresh" });
  });

  test("206 returns the body, ETag and Content-Range", async () => {
    const options = { acceptEncoding: "identity", range: "bytes=-10", timeoutMs: 5_000, decompress: false };
    expect(await get(url("/tail"), options)).toEqual({
      status: 206,
      body: "0123456789",
      etag: 'W/"v2"',
      contentRange: "bytes 90-99/100",
    });
  });

  test("a whole file sent for a Range request is cancelled, not downloaded", async () => {
    endlessCancelled = false;
    const options = { acceptEncoding: "identity", range: "bytes=-10", timeoutMs: 5_000, decompress: false };
    const error = await failure(get(url("/whole"), options));
    expect(error).toBeInstanceOf(RangeIgnoredError);
    for (let i = 0; i < 100 && !endlessCancelled; i++) await Bun.sleep(10);
    expect(endlessCancelled).toBe(true);
  });

  test("a gzip body is decompressed by default", async () => {
    expect(await get(url("/gzip"), plain)).toMatchObject({ status: 200, body: "squeezed" });
  });

  test("a compressed body is an error when decompression is off", async () => {
    const error = await failure(get(url("/gzip"), { acceptEncoding: "identity", timeoutMs: 5_000, decompress: false }));
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("gzip");
  });
});

describe("get: errors", () => {
  test("other statuses throw HttpError", async () => {
    const error = await failure(get(url("/broken"), plain));
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 500, url: url("/broken"), retryAfterSeconds: undefined });

    const missing = await failure(get(url("/nowhere"), plain));
    expect(missing).toMatchObject({ status: 404 });
  });

  test("Retry-After in seconds or as a date", async () => {
    expect(await failure(get(url("/limited"), plain))).toMatchObject({ status: 429, retryAfterSeconds: 120 });

    const dated = (await failure(get(url("/limited-date"), plain))) as HttpError;
    expect(dated.status).toBe(503);
    expect(dated.retryAfterSeconds).toBeGreaterThan(80);
    expect(dated.retryAfterSeconds).toBeLessThanOrEqual(90);

    expect(await failure(get(url("/limited-junk"), plain))).toMatchObject({ status: 429, retryAfterSeconds: undefined });
  });

  test("a redirect to another origin throws", async () => {
    const error = await failure(get(url("/away"), plain));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(HttpError);
    expect(String(error)).toContain("redirected");
    expect(otherRequests).toBe(0);
  });

  test("a redirect into /api/ throws, other same-origin redirects are followed", async () => {
    expect(String(await failure(get(url("/to-api"), plain)))).toContain("redirected");
    expect(apiRequests).toBe(0);
    expect(await get(url("/moved"), plain)).toMatchObject({ status: 200, body: "hello" });
    expect(await get(url("/api/jobs"), plain)).toMatchObject({ status: 200, body: "[]" });
  });

  test("times out waiting for headers", async () => {
    const started = performance.now();
    const error = await failure(get(url("/slow-headers"), { ...plain, timeoutMs: 100 }));
    expect(error).toMatchObject({ name: "TimeoutError" });
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  test("times out waiting for the rest of the body", async () => {
    const started = performance.now();
    const error = await failure(get(url("/slow-body"), { ...plain, timeoutMs: 100 }));
    expect(error).toMatchObject({ name: "TimeoutError" });
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});

describe("redirectTarget", () => {
  test("follows hops on its own site and returns the first address elsewhere, unrequested", async () => {
    const before = otherRequests;
    expect(await redirectTarget(url("/link"), 5_000)).toBe(`${other.url}job?id=7`);
    expect(otherRequests).toBe(before);
    expect(lastHeaders.get("user-agent")).toBe(USER_AGENT);
  });

  test("a link that ends on a page of its own site returns that page", async () => {
    expect(await redirectTarget(url("/moved"), 5_000)).toBe(url("/ok"));
    expect(await redirectTarget(url("/ok"), 5_000)).toBe(url("/ok"));
  });

  test("an error status throws HttpError", async () => {
    expect(await failure(redirectTarget(url("/gone"), 5_000))).toMatchObject({ status: 404 });
    expect(await failure(redirectTarget(url("/limited"), 5_000))).toMatchObject({ status: 429, retryAfterSeconds: 120 });
  });

  test("gives up after 5 redirects", async () => {
    expect(String(await failure(redirectTarget(url("/loop"), 5_000)))).toContain("more than 5 redirects");
  });
});
