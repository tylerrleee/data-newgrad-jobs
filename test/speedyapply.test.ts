import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canonicalKey } from "../src/canonical.ts";
import { HttpError } from "../src/http.ts";
import type { FetchContext, Listing } from "../src/job.ts";
import { parseSpeedyapply, speedyapplySource, speedyapplySources } from "../src/sources/speedyapply.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
const README = fixture("speedyapply-readme.md");
const INTL = fixture("speedyapply-intl.md");
const AFTERNOON = new Date("2026-09-24T18:00:00Z");

function only(listings: Listing[], company: string): Listing {
  const matches = listings.filter((listing) => listing.company === company);
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

describe("parseSpeedyapply", () => {
  const { listings, skipped, rows } = parseSpeedyapply(README, AFTERNOON, "swe");
  const intl = parseSpeedyapply(INTL, AFTERNOON, "swe").listings;

  test("reads Salary and no-Salary tables from the end of each row", () => {
    expect(rows).toBe(21);
    expect(skipped).toBe(2);
    expect(listings).toHaveLength(18);
    const url = "https://jobs.ashbyhq.com/ramp/a13ae586-f4cb-4385-8822-c42b9b54ed74";
    expect(only(listings, "Ramp")).toEqual({
      sourceId: url,
      url,
      key: canonicalKey(url),
      company: "Ramp",
      title: "Software Engineer Internship - Frontend",
      locations: ["New York City, NY"],
      category: "swe",
      postedDay: "2026-09-24",
      roleMatch: false,
      entryLevel: false,
      active: true,
      raw: README.split("\n").find((line) => line.includes(url))!,
    });
    expect(only(listings, "Schonfeld")).toMatchObject({
      title: "2027 Software Engineering Intern",
      locations: ["New York City, NY"],
      postedDay: "2026-09-04",
    });
    expect(only(listings, "CACI")).toMatchObject({
      title: "Software Engineering Intern - Summer 2027",
      locations: ["Sterling, VA"],
      postedDay: "2026-09-23",
    });
  });

  test("strips tags from a <strong>-only company", () => {
    expect(only(listings, "Acme Robotics").title).toBe("Software Engineer Intern");
  });

  test("keeps a | inside a title", () => {
    expect(only(listings, "Two Sigma")).toMatchObject({
      title: "Software Engineer Intern | Trading Platform",
      locations: ["New York City, NY"],
    });
  });

  test("keeps & raw in titles and URLs", () => {
    expect(only(listings, "Box")).toMatchObject({ title: "Cloud & AI Finance Intern", roleMatch: false });
    expect(only(listings, "Gemini").url).toBe(
      "https://boards.greenhouse.io/embed/job_app?for=gemini&token=8214272&gh_jid=8214272",
    );
  });

  test("removes zero-width spaces", () => {
    expect(only(listings, "Tencent").title).toBe("Hunyuan Multimodal Algorithm Researcher Intern- Omni-Modal");
    expect(only(intl, "TD Bank").title).toBe("Mobile Software Engineer Co-op / Intern - Winter 2027");
  });

  test("trims padded cells", () => {
    expect(only(listings, "Example Health")).toMatchObject({
      title: "Data Science Intern",
      locations: ["Austin, TX"],
      postedDay: "2026-09-22",
    });
  });

  test("an empty location gives no locations", () => {
    expect(only(intl, "Philips").locations).toEqual([]);
  });

  test("keeps the +N suffix of a location", () => {
    expect(only(listings, "General Motors").locations).toEqual(["Warren, MI +3"]);
    expect(only(listings, "DoorDash").locations).toEqual(["San Francisco, CA +4"]);
  });

  test("de-duplicates by URL, last row wins", () => {
    expect(only(listings, "SeatGeek").locations).toEqual(["New York, NY"]);
  });

  test("skips rows without an apply link or a day age", () => {
    expect(listings.map((listing) => listing.company)).not.toContain("ClosedCo");
    expect(listings.map((listing) => listing.company)).not.toContain("OddAge");
    const relative = README.replace(
      '<a href="https://jobs.ashbyhq.com/ramp/a13ae586-f4cb-4385-8822-c42b9b54ed74">',
      '<a href="/INTERN_INTL.md">',
    );
    const result = parseSpeedyapply(relative, AFTERNOON, "swe");
    expect(result.skipped).toBe(3);
    expect(result.listings.map((listing) => listing.company)).not.toContain("Ramp");
  });

  test("classifies titles", () => {
    expect(only(listings, "Northwind")).toMatchObject({ roleMatch: false, entryLevel: true });
    expect(parseSpeedyapply(INTL, AFTERNOON, "ai").listings.every((listing) => listing.category === "ai")).toBe(true);
  });

  test("dates count back from the day the file was generated", () => {
    const microsoft = listings.find((listing) => listing.title === "Software Engineering Intern - CTJ - TS");
    expect(only(listings, "Ramp").postedDay).toBe("2026-09-24");
    expect(microsoft!.postedDay).toBe("2026-09-12");
    const early = parseSpeedyapply(README, new Date("2026-09-25T11:00:00Z"), "swe").listings;
    expect(only(early, "Ramp").postedDay).toBe("2026-09-24");
  });

  test("throws when a marker is missing", () => {
    for (const table of ["TABLE_FAANG", "TABLE_QUANT", "TABLE"]) {
      for (const edge of ["START", "END"]) {
        const marker = `<!-- ${table}_${edge} -->`;
        expect(() => parseSpeedyapply(README.replace(marker, ""), AFTERNOON, "swe")).toThrow(`missing ${marker}`);
      }
    }
  });

  test("throws when a header changes", () => {
    const renamed = README.replace(
      "| Company | Position | Location | Posting | Age |",
      "| Company | Role | Location | Posting | Age |",
    );
    expect(() => parseSpeedyapply(renamed, AFTERNOON, "swe")).toThrow("unexpected TABLE header");
    const added = README.replace(
      "| Company | Position | Location | Salary | Posting | Age |",
      "| Company | Position | Location | Salary | Posting | Age | Visa |",
    );
    expect(() => parseSpeedyapply(added, AFTERNOON, "swe")).toThrow("unexpected TABLE_FAANG header");
  });
});

describe("speedyapplySource", () => {
  const ETAG = '"v1"';
  const requests: Headers[] = [];
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(request.headers);
        const path = new URL(request.url).pathname;
        if (path === "/broken.md") return new Response(INTL.replace(/<a href="https:\/\/(td|philips)\.[^"]*">/g, ""));
        if (path !== "/INTERN_INTL.md") return new Response("not found", { status: 404 });
        if (request.headers.get("if-none-match") === ETAG) return new Response(null, { status: 304 });
        return new Response(INTL, { headers: { ETag: ETAG } });
      },
    });
  });
  afterAll(() => server.stop(true));

  const context = (now: Date, etag?: string): FetchContext => ({
    now,
    etag,
    lastSuccessAt: undefined,
    lastFullAt: undefined,
    storedRaw: () => undefined,
  });
  const feed = (path: string) => speedyapplySource("speedyapply-swe-intl", new URL(path, server.url).href, "swe");

  test("200 returns every listing, the ETag and the next check at 12:00Z", async () => {
    const result = await feed("/INTERN_INTL.md").fetchListings(context(new Date("2026-09-24T23:30:00Z")));
    expect(requests.at(-1)!.get("accept-encoding")).toBe("gzip");
    expect(requests.at(-1)!.get("if-none-match")).toBeNull();
    expect(result).toMatchObject({
      changed: true,
      complete: true,
      etag: ETAG,
      skipped: 0,
      nextAttemptAt: new Date("2026-09-25T12:00:00Z"),
    });
    expect(result.changed && result.listings).toHaveLength(10);
  });

  test("checks only while the daily regeneration can land (12:00–22:30 UTC)", async () => {
    for (const [now, next] of [
      ["2026-09-25T01:45:00Z", new Date("2026-09-25T12:00:00Z")],
      ["2026-09-25T11:59:00Z", new Date("2026-09-25T12:00:00Z")],
      // A 200 inside the window may still be yesterday's file, so keep checking.
      ["2026-09-25T12:00:00Z", undefined],
      ["2026-09-25T22:29:00Z", undefined],
      ["2026-09-25T22:30:00Z", new Date("2026-09-26T12:00:00Z")],
      ["2026-12-31T23:45:00Z", new Date("2027-01-01T12:00:00Z")],
    ] as const) {
      const result = await feed("/INTERN_INTL.md").fetchListings(context(new Date(now)));
      expect(result.changed && result.nextAttemptAt).toEqual(next);
    }
    const unchanged = await feed("/INTERN_INTL.md").fetchListings(context(new Date("2026-09-25T23:45:00Z"), ETAG));
    expect(unchanged).toEqual({ changed: false, nextAttemptAt: new Date("2026-09-26T12:00:00Z") });
  });

  test("304 means unchanged", async () => {
    const result = await feed("/INTERN_INTL.md").fetchListings(context(new Date("2026-09-25T13:45:00Z"), ETAG));
    expect(requests.at(-1)!.get("if-none-match")).toBe(ETAG);
    expect(requests.at(-1)!.get("accept-encoding")).toBe("gzip");
    expect(result).toEqual({ changed: false, nextAttemptAt: undefined });
  });

  test("fails when more than 5% of rows can't be parsed", async () => {
    await expect(feed("/broken.md").fetchListings(context(AFTERNOON))).rejects.toThrow("2 of 10 rows");
  });

  test("HTTP errors fail the feed", async () => {
    await expect(feed("/gone.md").fetchListings(context(AFTERNOON))).rejects.toBeInstanceOf(HttpError);
  });
});

test("speedyapplySources lists the two US new-grad files", () => {
  const sources = speedyapplySources();
  expect(sources.map((source) => source.name)).toEqual(["speedyapply-ai-newgrad-us", "speedyapply-swe-newgrad-us"]);
  expect(sources.every((source) => source.source === "speedyapply" && source.minIntervalMinutes === 20)).toBe(true);
});
