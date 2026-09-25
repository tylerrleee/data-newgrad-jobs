import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { canonicalKey } from "../src/canonical.ts";
import type { FetchContext, FetchResult } from "../src/job.ts";
import { parseSimplifyTail, simplifyListing, simplifySource } from "../src/sources/simplify.ts";

// The last 16,000 bytes of the real listings.json (2026-09-24): it starts mid-record and ends in "\n]".
const TAIL = await Bun.file(`${import.meta.dir}/fixtures/simplify-tail.txt`).text();
const REAL = parseSimplifyTail(TAIL) as Record<string, unknown>[];

/** Python's json.dumps(value, indent=4), which Simplify uses (ensure_ascii escapes included). */
function pythonJson(value: unknown): string {
  return JSON.stringify(value, null, 4).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...REAL.at(-1)!, ...overrides };
}

describe("parseSimplifyTail", () => {
  test("drops the partial first record of a tail sliced mid-record", () => {
    expect(TAIL.startsWith("y\",\n")).toBe(true);
    expect(TAIL.endsWith("\n    }\n]")).toBe(true);
    expect(REAL).toHaveLength(19);
    expect(REAL.map((r) => r.id)).not.toContain("e893c8a9-6a16-4e98-b3e6-3ef4b5b81b50");
    expect(REAL[0]!.id).toBe("33fee74b-b1b5-410a-8477-e050b2b8614c");
    expect(REAL.at(-1)!.id).toBe("140fab22-0b1d-498c-a250-8373856250d9");
    // Re-serializing reproduces the file byte for byte, so the parser saw the real layout.
    expect(pythonJson(REAL)).toBe(`[${TAIL.slice(TAIL.indexOf("\n    {\n"))}`);
  });

  test("parses a whole file, including the last piece ending in \\n]", () => {
    const records = [record({ id: "a" }), record({ id: "b" })];
    expect(parseSimplifyTail(pythonJson(records))).toEqual(records);
    expect(parseSimplifyTail(`${pythonJson(records)}\n`)).toEqual(records);
  });

  test("a slice starting exactly at a record boundary keeps that record", () => {
    const body = pythonJson([record({ id: "a" }), record({ id: "b" })]);
    expect(parseSimplifyTail(body.slice(body.lastIndexOf("\n    {\n")))).toEqual([record({ id: "b" })]);
  });

  test("gives the same raw JSON as parsing the whole file, including \\u escapes", () => {
    const records = [record({ id: "a", title: "Software Dev/AI Tools – Co-op/Intern" }), record({ id: "b" })];
    const body = pythonJson(records);
    expect(body).toContain("\\u2013");
    const fromTail = parseSimplifyTail(body).map((r) => JSON.stringify(r));
    expect(fromTail).toEqual((JSON.parse(body) as unknown[]).map((r) => JSON.stringify(r)));
  });

  test("throws on an indent=2 body", () => {
    expect(() => parseSimplifyTail(JSON.stringify([record()], null, 2))).toThrow(/indent=4/);
  });

  test("throws when a piece does not parse", () => {
    const body = pythonJson([record({ id: "a" }), record({ id: "b" })]);
    expect(() => parseSimplifyTail(body.slice(0, -40))).toThrow(/record 2 of 2 does not parse/);
    expect(() => parseSimplifyTail(body.replace('"active": true', '"active": tru'))).toThrow(/does not parse/);
  });
});

describe("simplifyListing", () => {
  test("maps a real record", () => {
    const tradeweb = REAL.find((r) => r.id === "65953c6c-4e10-43b0-bebf-f1a326199c76")!;
    const url = "https://ecnf.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/301931";
    expect(simplifyListing(tradeweb)).toEqual({
      sourceId: "65953c6c-4e10-43b0-bebf-f1a326199c76",
      url,
      key: canonicalKey(url),
      company: "Tradeweb",
      title: "Quantitative Intern",
      locations: ["New York, NY"],
      category: "Quant",
      // 1790288051 is 18:14 in New York on the 24th.
      postedDay: "2026-09-24",
      software: false,
      internship: true,
      active: true,
      raw: JSON.stringify(tradeweb),
    });
    expect(canonicalKey(url)).toBe("oracle:ecnf:301931");
  });

  test("reads midnight UTC as a calendar date and anything else as an instant in New York", () => {
    expect(simplifyListing(record({ date_posted: 1790208000 }))!.postedDay).toBe("2026-09-24");
    expect(simplifyListing(record({ date_posted: 1790222399 }))!.postedDay).toBe("2026-09-23");
    expect(simplifyListing(record({ date_posted: 1790222400 }))!.postedDay).toBe("2026-09-24");
  });

  test("expands only exact SF, NYC and LA and cleans text", () => {
    const listing = simplifyListing(
      record({
        locations: [" SF ", "NYC", "LA", "SF Bay Area", "Los Angeles, CA", "", "constructor"],
        company_name: "Acme​  Corp",
        title: " Software   Intern ",
      }),
    )!;
    expect(listing.locations).toEqual([
      "San Francisco, CA",
      "New York, NY",
      "Los Angeles, CA",
      "SF Bay Area",
      "Los Angeles, CA",
      "constructor",
    ]);
    expect(listing.company).toBe("Acme Corp");
    expect(listing.title).toBe("Software Intern");
  });

  test("is active only when both active and visible", () => {
    expect(simplifyListing(record({ active: true, is_visible: true }))!.active).toBe(true);
    expect(simplifyListing(record({ active: false, is_visible: true }))!.active).toBe(false);
    expect(simplifyListing(record({ active: true, is_visible: false }))!.active).toBe(false);
    expect(simplifyListing(record({ active: true, is_visible: undefined }))!.active).toBe(false);
  });

  test("classifies with category and title", () => {
    const hardware = simplifyListing(record({ category: "Hardware", title: "Embedded Software Intern" }))!;
    expect(hardware.software).toBe(true);
    const product = simplifyListing(record({ category: "Product", title: "Product Management Intern" }))!;
    expect(product.software).toBe(false);
    const missing = simplifyListing(record({ category: undefined, title: "New Grad Software Engineer" }))!;
    expect(missing.category).toBeNull();
    expect(missing.internship).toBe(false);
  });

  test("keeps the record verbatim as raw and ignores terms", () => {
    const input = record({ terms: ["whatever"] });
    expect(simplifyListing(input)!.raw).toBe(JSON.stringify(input));
  });

  test("is undefined without a usable id, url or date_posted", () => {
    for (const bad of [
      { url: "" },
      { url: "mailto:jobs@example.com" },
      { url: undefined },
      { date_posted: undefined },
      { date_posted: 0 },
      { date_posted: "1790208000" },
      { id: undefined },
      { id: "" },
    ]) {
      expect(simplifyListing(record(bad))).toBeUndefined();
    }
    expect(simplifyListing(null)).toBeUndefined();
    expect(simplifyListing("text")).toBeUndefined();
  });

  test("cleans junk after the URL", () => {
    const listing = simplifyListing(record({ url: "https://jobs.example.com/job/12345%22%3E" }))!;
    expect(listing.url).toBe("https://jobs.example.com/job/12345");
  });
});

// Emulates raw.githubusercontent.com: strong ETags that differ by encoding, suffix Range requests
// answered with 206, 304 on a matching If-None-Match, gzip when asked.
const upstream = { body: "", etag: '"identity-v2"', gzipEtag: '"gzip-v2"', ignoreRange: false };
const requests: Headers[] = [];
const server = Bun.serve({
  port: 0,
  fetch(request) {
    requests.push(request.headers);
    const gzip = request.headers.get("accept-encoding") === "gzip";
    const etag = gzip ? upstream.gzipEtag : upstream.etag;
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
    const bytes = new TextEncoder().encode(upstream.body);
    const range = /^bytes=-(\d+)$/.exec(request.headers.get("range") ?? "");
    if (range && !upstream.ignoreRange) {
      const start = Math.max(0, bytes.length - Number(range[1]));
      return new Response(bytes.slice(start), {
        status: 206,
        headers: { etag, "content-range": `bytes ${start}-${bytes.length - 1}/${bytes.length}` },
      });
    }
    if (gzip) return new Response(Bun.gzipSync(bytes), { headers: { etag, "content-encoding": "gzip" } });
    return new Response(bytes, { headers: { etag } });
  },
});
afterAll(() => server.stop(true));
const URL_ = new URL("/SimplifyJobs/listings.json", server.url).href;

const NOW = new Date("2026-09-24T23:30:00Z");
function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

/** Real records under synthetic ids, enough that the 256 KB tail starts mid-file. */
function manyRecords(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    ...REAL[i % REAL.length],
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  }));
}

const RECORDS = manyRecords(450);
const BODY = pythonJson(RECORDS);
const SMALL = { minFullRecords: 100 };

function context(stored: Map<string, string>, overrides: Partial<FetchContext> = {}): FetchContext {
  return {
    now: NOW,
    etag: '"identity-v1"',
    lastSuccessAt: hoursAgo(1),
    lastFullAt: hoursAgo(12),
    storedRaw: (id) => stored.get(id),
    ...overrides,
  };
}

function stored(records: Record<string, unknown>[]): Map<string, string> {
  return new Map(records.map((r) => [r.id as string, JSON.stringify(r)]));
}

function changed(result: FetchResult) {
  if (!result.changed) throw new Error("expected a changed result");
  return result;
}

function expectFullRequest(headers: Headers): void {
  expect(headers.get("accept-encoding")).toBe("gzip");
  expect(headers.get("if-none-match")).toBeNull();
  expect(headers.get("range")).toBeNull();
}

function expectTailRequest(headers: Headers, etag: string): void {
  expect(headers.get("accept-encoding")).toBe("identity");
  expect(headers.get("range")).toBe("bytes=-262144");
  expect(headers.get("if-none-match")).toBe(etag);
}

beforeEach(() => {
  requests.length = 0;
  upstream.body = BODY;
  upstream.ignoreRange = false;
});

describe("simplifySource", () => {
  test("has the feed settings", () => {
    const source = simplifySource(URL_);
    expect(source.name).toBe("simplify");
    expect(source.source).toBe("simplify");
    expect(source.minIntervalMinutes).toBe(20);
  });

  test("the first run fetches the whole file with gzip and keeps no ETag", async () => {
    const ctx = context(new Map(), { etag: undefined, lastSuccessAt: undefined, lastFullAt: undefined });
    const result = changed(await simplifySource(URL_, SMALL).fetchListings(ctx));
    expect(requests).toHaveLength(1);
    expectFullRequest(requests[0]!);
    expect(requests[0]!.get("user-agent")).toStartWith("jobbo/");
    expect(result.complete).toBe(true);
    expect(result.full).toBe(true);
    expect(result.etag).toBeUndefined();
    expect(result.detail).toBe("full");
    expect(result.skipped).toBe(0);
    expect(result.listings.map((l) => l.sourceId)).toEqual(RECORDS.map((r) => r.id as string));
  });

  test("fetches the whole file a day after the last full fetch or success, without If-None-Match", async () => {
    const source = simplifySource(URL_, SMALL);
    for (const overrides of [{ lastFullAt: hoursAgo(24) }, { lastSuccessAt: hoursAgo(24.01), lastFullAt: hoursAgo(23) }]) {
      requests.length = 0;
      const result = changed(await source.fetchListings(context(stored(RECORDS), overrides)));
      expect(result.full).toBe(true);
      expect(requests).toHaveLength(1);
      expectFullRequest(requests[0]!);
    }
  });

  test("reads the tail when it holds an unchanged stored record", async () => {
    const window = parseSimplifyTail(BODY.slice(-262_144)) as Record<string, unknown>[];
    expect(window.length).toBeGreaterThan(100);
    expect(window.length).toBeLessThan(RECORDS.length);
    const known = stored([window[0]!]);
    const result = changed(await simplifySource(URL_, SMALL).fetchListings(context(known)));
    expect(requests).toHaveLength(1);
    expectTailRequest(requests[0]!, '"identity-v1"');
    expect(result.complete).toBe(false);
    expect(result.full).toBeUndefined();
    expect(result.etag).toBe('"identity-v2"');
    expect(result.detail).toBe("tail");
    expect(result.listings.map((l) => l.sourceId)).toEqual(RECORDS.slice(-window.length).map((r) => r.id as string));
  });

  test("304 means unchanged", async () => {
    const ctx = context(stored(RECORDS), { etag: '"identity-v2"' });
    expect(await simplifySource(URL_, SMALL).fetchListings(ctx)).toEqual({ changed: false });
    expect(requests).toHaveLength(1);
    expectTailRequest(requests[0]!, '"identity-v2"');
  });

  test("falls back to a full fetch when every known record in the tail was re-appended with edits", async () => {
    const edited = stored(RECORDS.map((r) => ({ ...r, title: "Old title" })));
    const result = changed(await simplifySource(URL_, SMALL).fetchListings(context(edited)));
    expect(requests).toHaveLength(2);
    expectTailRequest(requests[0]!, '"identity-v1"');
    expectFullRequest(requests[1]!);
    expect(result.full).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.etag).toBeUndefined();
    expect(result.detail).toBe("full (tail gap)");
    expect(result.listings).toHaveLength(RECORDS.length);
  });

  test("falls back to a full fetch when no record in the tail is known", async () => {
    const result = changed(await simplifySource(URL_, SMALL).fetchListings(context(new Map())));
    expect(result.full).toBe(true);
    expect(requests).toHaveLength(2);
  });

  test("waits for the next full fetch when the tail has no overlap right after one", async () => {
    const edited = stored(RECORDS.map((r) => ({ ...r, title: "Old title" })));
    const ctx = context(edited, { lastFullAt: hoursAgo(1) });
    expect(await simplifySource(URL_, SMALL).fetchListings(ctx)).toEqual({
      changed: false,
      detail: "tail unusable (tail gap), waiting for the next full fetch",
    });
    expect(requests).toHaveLength(1);
  });

  test("falls back to a full fetch when the server ignores Range", async () => {
    upstream.ignoreRange = true;
    const result = changed(await simplifySource(URL_, SMALL).fetchListings(context(stored(RECORDS))));
    expect(requests).toHaveLength(2);
    expectTailRequest(requests[0]!, '"identity-v1"');
    expectFullRequest(requests[1]!);
    expect(result.detail).toBe("full (range ignored)");
    expect(result.listings).toHaveLength(RECORDS.length);
  });

  test("waits for the next full fetch when the server ignores Range right after one", async () => {
    upstream.ignoreRange = true;
    const ctx = context(stored(RECORDS), { lastFullAt: hoursAgo(5.9) });
    const result = await simplifySource(URL_, SMALL).fetchListings(ctx);
    expect(result).toMatchObject({ changed: false, detail: expect.stringContaining("range ignored") });
    expect(requests).toHaveLength(1);
  });

  test("keeps the last of duplicate ids", async () => {
    const first = record({ id: "dup", title: "First Software Intern" });
    const last = record({ id: "dup", title: "Last Software Intern" });
    upstream.body = pythonJson([first, ...RECORDS, last]);
    const source = simplifySource(URL_, SMALL);
    const full = changed(await source.fetchListings(context(new Map(), { lastSuccessAt: undefined })));
    expect(full.listings.filter((l) => l.sourceId === "dup").map((l) => l.title)).toEqual(["Last Software Intern"]);
    upstream.body = pythonJson([...RECORDS, first, last]);
    const tail = changed(await source.fetchListings(context(stored(RECORDS))));
    expect(tail.detail).toBe("tail");
    expect(tail.listings.filter((l) => l.sourceId === "dup").map((l) => l.title)).toEqual(["Last Software Intern"]);
  });

  test("throws on a full file with too few records; a short tail falls back to a full fetch", async () => {
    await expect(simplifySource(URL_).fetchListings(context(new Map(), { lastFullAt: undefined }))).rejects.toThrow(
      /full file has 450 records, expected at least 5000/,
    );
    const short = simplifySource(URL_, { ...SMALL, minTailRecords: 1000 });
    const result = changed(await short.fetchListings(context(stored(RECORDS))));
    expect(result.detail).toMatch(/^full \(only \d+ records, expected at least 1000\)$/);
  });

  test("throws when the full file is not an array", async () => {
    upstream.body = JSON.stringify({ listings: RECORDS });
    await expect(simplifySource(URL_, SMALL).fetchListings(context(new Map(), { lastFullAt: undefined }))).rejects.toThrow(
      /full file has no records/,
    );
  });

  test("a tail that isn't indent=4 falls back to a full fetch, or waits for one", async () => {
    upstream.body = JSON.stringify(RECORDS, null, 2);
    const source = simplifySource(URL_, SMALL);
    expect(changed(await source.fetchListings(context(stored(RECORDS)))).detail).toMatch(/^full \(.*indent=4/);
    const recent = await source.fetchListings(context(stored(RECORDS), { lastFullAt: hoursAgo(1) }));
    expect(recent).toMatchObject({ changed: false, detail: expect.stringContaining("indent=4") });
  });

  test("counts unusable records and throws above 5%", async () => {
    const broken = (count: number) => RECORDS.map((r, i) => (i < count ? { ...r, url: "" } : r));
    const source = simplifySource(URL_, SMALL);
    const first = context(new Map(), { lastFullAt: undefined });
    upstream.body = pythonJson(broken(22));
    const result = changed(await source.fetchListings(first));
    expect(result.skipped).toBe(22);
    expect(result.listings).toHaveLength(RECORDS.length - 22);
    upstream.body = pythonJson(broken(23));
    await expect(source.fetchListings(first)).rejects.toThrow(/23 of 450 records have no usable id, url or date_posted/);
    upstream.body = pythonJson(RECORDS.map((r) => ({ ...r, date_posted: null })));
    await expect(source.fetchListings(context(stored(RECORDS)))).rejects.toThrow(/have no usable/);
  });
});
