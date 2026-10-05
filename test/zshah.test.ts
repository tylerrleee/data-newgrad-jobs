import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HttpError } from "../src/http.ts";
import type { FetchContext } from "../src/job.ts";
import { zshahListing, zshahSource } from "../src/sources/zshah.ts";

// Six real records from zshah101's data/jobs.json (2026-09-29): open and closed, each date form.
const FIXTURE = await Bun.file(`${import.meta.dir}/fixtures/zshah-jobs.json`).text();
const RECORDS = JSON.parse(FIXTURE) as Record<string, Record<string, unknown>>;
const record = (id: string, overrides: Record<string, unknown> = {}) => ({ ...RECORDS[id]!, ...overrides });

const ABB = "workday:abb:/job/USA-NC-Cary/IS-Common-Infrastructure-Intern--Summer-2027_JR00047125";
const ADVANCED_SPACE = "greenhouse:advancedspace:4324855009";
const HADRIAN = "ashby:hadrian-automation:f718bcfe-3f5b-4682-a294-697499caf813";
const APPIAN = "greenhouse:appian:8088496";
const ONE_PASSWORD = "ashby:1password:8f8774dc-e400-48b1-8100-c6840b8eaed1";
const AQUATIC = "greenhouse:aquaticcapitalmanagement:8489233002";

describe("zshahListing", () => {
  test("maps every field", () => {
    const raw = record(ADVANCED_SPACE);
    expect(zshahListing(raw)).toEqual({
      sourceId: ADVANCED_SPACE,
      url: "https://job-boards.greenhouse.io/advancedspace/jobs/4324855009",
      key: "gh:4324855009",
      company: "Advanced Space",
      title: "2027 Software Engineering Summer Internship",
      locations: ["Westminster, CO"],
      category: "Software",
      postedDay: "2026-08-24",
      roleMatch: false,
      entryLevel: false,
      active: true,
      raw: JSON.stringify(raw),
    });
  });

  test("keys a Workday job like the other sources do", () => {
    expect(zshahListing(record(ABB))).toMatchObject({ key: "wd:abb:JR00047125", postedDay: "2026-09-24" });
  });

  test("dates: an exact posted_at is its New York day; without one, first_seen_at", () => {
    expect(zshahListing(record(HADRIAN))!.postedDay).toBe("2026-09-02");
    expect(zshahListing(record(AQUATIC))!.postedDay).toBe("2026-06-30");
  });

  test("closed jobs are inactive", () => {
    expect(zshahListing(record(ONE_PASSWORD))!.active).toBe(false);
    expect(zshahListing(record(AQUATIC))!.active).toBe(false);
  });

  test("classifies by category and title", () => {
    expect(zshahListing(record(HADRIAN))).toMatchObject({ category: "Data & ML/AI", roleMatch: true });
    expect(zshahListing(record(APPIAN))).toMatchObject({ category: "Security", roleMatch: false });
    expect(zshahListing(record(HADRIAN, { title: "Sustainability Intern" }))!.roleMatch).toBe(false);
  });

  test("skips records without an id, usable url or date", () => {
    expect(zshahListing(record(APPIAN, { url: "Closed" }))).toBeUndefined();
    expect(zshahListing(record(APPIAN, { id: 42 }))).toBeUndefined();
    expect(zshahListing(record(APPIAN, { posted_at: null, first_seen_at: null }))).toBeUndefined();
    expect(zshahListing(null)).toBeUndefined();
  });
});

describe("zshahSource", () => {
  const ETAG = '"v1"';
  const requests: Headers[] = [];
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(request.headers);
        const path = new URL(request.url).pathname;
        if (path === "/broken.json") {
          const broken = Object.values(RECORDS).map((raw, index) => (index < 2 ? { ...raw, url: "Closed" } : raw));
          return Response.json(Object.fromEntries(broken.map((raw) => [raw.id, raw])));
        }
        if (path === "/list.json") return Response.json(Object.values(RECORDS));
        if (path !== "/jobs.json") return new Response("not found", { status: 404 });
        if (request.headers.get("if-none-match") === ETAG) return new Response(null, { status: 304 });
        return new Response(FIXTURE, { headers: { ETag: ETAG } });
      },
    });
  });
  afterAll(() => server.stop(true));

  const context = (etag?: string): FetchContext => ({
    now: new Date("2026-09-29T21:30:00Z"),
    etag,
    lastSuccessAt: undefined,
    lastFullAt: undefined,
    storedRaw: () => undefined,
  });
  const feed = (path: string, minRecords = 5) => zshahSource(new URL(path, server.url).href, { minRecords });

  test("200 returns every job, open or closed, as a complete snapshot", async () => {
    const result = await feed("/jobs.json").fetchListings(context());
    expect(requests.at(-1)!.get("accept-encoding")).toBe("gzip");
    expect(result).toMatchObject({ changed: true, complete: true, etag: ETAG, skipped: 0 });
    expect(result.changed && result.listings.map((listing) => listing.active)).toEqual([
      true, true, true, true, false, false,
    ]);
  });

  test("304 means unchanged", async () => {
    expect(await feed("/jobs.json").fetchListings(context(ETAG))).toEqual({ changed: false });
    expect(requests.at(-1)!.get("if-none-match")).toBe(ETAG);
  });

  test("throws on fewer than minRecords jobs", async () => {
    await expect(feed("/jobs.json", 7).fetchListings(context())).rejects.toThrow("has 6 jobs, expected at least 7");
  });

  test("throws when the file is not an object of jobs", async () => {
    await expect(feed("/list.json").fetchListings(context())).rejects.toThrow("format change?");
  });

  test("fails when more than 5% of jobs are unusable", async () => {
    await expect(feed("/broken.json").fetchListings(context())).rejects.toThrow("2 of 6 jobs");
  });

  test("HTTP errors fail the feed", async () => {
    await expect(feed("/gone.json").fetchListings(context())).rejects.toBeInstanceOf(HttpError);
  });
});
