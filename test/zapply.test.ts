import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HttpError } from "../src/http.ts";
import type { FetchContext, FetchResult, Listing } from "../src/job.ts";
import { parseZapply, zapplySource } from "../src/sources/zapply.ts";

// The start and two sections of the real README (2026-09-29), trimmed to nine rows.
const README = await Bun.file(`${import.meta.dir}/fixtures/zapply-readme.md`).text();
const EVENING = new Date("2026-09-29T21:30:00Z");
const MOOG = "workday-moog-moog-external-career-site-R-26-19948";
const MOOG_URL =
  "https://moog.wd5.myworkdayjobs.com/moog_external_career_site/job/Torrance-CA/Intern--Software-Engineering_R-26-19948";
const TARGETS: Record<string, string> = {
  [MOOG]: MOOG_URL,
  "greenhouse-waymo-8234670": "https://careers.withwaymo.com/jobs?gh_jid=8234670",
  "lever-hermeus-78008094-ca81-4a0c-9a18-93b30f932acd":
    "https://jobs.lever.co/hermeus/78008094-ca81-4a0c-9a18-93b30f932acd",
};
const oldRow = (slug: string) =>
  `| **Acme** | Software Engineer Intern | Austin, TX | 2d |  | [<img src="images/apply.png" width="80" alt="Apply">](https://zapply.jobs/l/d/${slug}?s=gh-internships-2027) |`;

describe("parseZapply", () => {
  test("reads every section's rows, with the section as category", () => {
    const { rows, skipped } = parseZapply(README);
    expect(skipped).toBe(0);
    expect(rows.map((r) => [r.company, r.section, r.age])).toEqual([
      ["Nike", "Software Engineering", "33m"],
      ["Moog", "Software Engineering", "1h"],
      ["Waymo", "Software Engineering", "1d"],
      ["Hermeus", "Software Engineering", "18h"],
      ["D. E. Shaw", "Software Engineering", "Date unknown"],
      ["General Motors", "Software Engineering", "6d"],
      ["Moderna", "Data Science & AI", "13m"],
      ["Symbotic", "Data Science & AI", "1w"],
      ["onsemi", "Data Science & AI", "1d"],
    ]);
    expect(rows[1]).toEqual({
      slug: MOOG,
      company: "Moog",
      title: "Intern, Software Engineering",
      location: "Torrance, CA",
      section: "Software Engineering",
      age: "1h",
      raw: README.split("\n").find((line) => line.includes(MOOG))!,
    });
    expect(rows[7]!.location).toBe("USA Wilmington, MA -");
  });

  test("keeps a | inside a title", () => {
    const { rows } = parseZapply(README.replace("| Intern, Software Engineering |", "| Intern | Software Engineering |"));
    expect(rows[1]!.title).toBe("Intern | Software Engineering");
  });

  test("counts rows without a zapply link as skipped", () => {
    const { rows, skipped } = parseZapply(README.replace(/https:\/\/zapply\.jobs\/l\/d\/greenhouse-waymo[^)]*/, "#"));
    expect([rows.length, skipped]).toEqual([8, 1]);
  });

  test("throws when a table header changes or there are no tables", () => {
    expect(() => parseZapply(README.replaceAll("| Visa |", "| Sponsorship |"))).toThrow(
      "unexpected Software Engineering table header",
    );
    expect(() => parseZapply("# Internships 2027\n")).toThrow("no job tables");
  });
});

describe("zapplySource", () => {
  const ETAG = '"v1"';
  const linkRequests: string[] = [];
  const failing = new Set<string>();
  const dead = new Set<string>();
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        const link = /^\/l\/d\/([^/]+)\/$/.exec(path)?.[1];
        if (link) {
          linkRequests.push(link);
          if (failing.has(link)) return new Response("not found", { status: 404 });
          if (dead.has(link)) return Response.redirect("/jobs", 302);
          return Response.redirect(TARGETS[link] ?? `https://jobs.example.com/${link}`, 302);
        }
        if (path === "/jobs") return new Response("zapply's job board");
        if (path === "/many.md") {
          const rows = Array.from({ length: 160 }, (_, n) => oldRow(`workday-acme-acme-R${n}`));
          return new Response(README.replace(/(\|-+)+\|\n/, (separator) => `${separator}${rows.join("\n")}\n`));
        }
        if (path === "/unreadable.md") return new Response(README.replace("| 33m |", "| soon |").replace("| 13m |", "| now |"));
        if (path !== "/README.md") return new Response("not found", { status: 404 });
        if (request.headers.get("if-none-match") === ETAG) return new Response(null, { status: 304 });
        return new Response(README, { headers: { ETag: ETAG } });
      },
    });
  });
  afterAll(() => server.stop(true));

  const context = (stored: Listing[] = [], etag?: string): FetchContext => ({
    now: EVENING,
    etag,
    lastSuccessAt: undefined,
    lastFullAt: undefined,
    storedRaw: (sourceId) => stored.find((listing) => listing.sourceId === sourceId)?.raw,
  });
  const feed = (path: string, { links = "/l/d/", minRows = 5 } = {}) =>
    zapplySource(new URL(path, server.url).href, { links: new URL(links, server.url).href, minRows });
  const listingsOf = (result: FetchResult): Listing[] => (result.changed ? result.listings : []);

  test("follows each new link once to its employer URL", async () => {
    const before = linkRequests.length;
    const result = await feed("/README.md").fetchListings(context());
    expect(linkRequests.length - before).toBe(8);
    expect(result).toMatchObject({
      changed: true,
      complete: true,
      etag: ETAG,
      skipped: 0,
      detail: "8 new links resolved, 1 undated rows ignored",
    });
    const moog = listingsOf(result).find((listing) => listing.sourceId === MOOG);
    expect(moog).toEqual({
      sourceId: MOOG,
      url: MOOG_URL,
      key: "wd:moog:R-26-19948",
      company: "Moog",
      title: "Intern, Software Engineering",
      locations: ["Torrance, CA"],
      category: "Software Engineering",
      postedDay: "2026-09-29",
      software: true,
      internship: true,
      active: true,
      raw: JSON.stringify({ row: README.split("\n").find((line) => line.includes(MOOG)), url: MOOG_URL }),
    });
    expect(listingsOf(result).map((listing) => listing.key)).toContain("gh:8234670");
  });

  test("reuses the employer URLs stored on earlier runs", async () => {
    const first = listingsOf(await feed("/README.md").fetchListings(context()));
    const before = linkRequests.length;
    const again = await feed("/README.md").fetchListings(context(first));
    expect(linkRequests.length).toBe(before);
    expect(again).toMatchObject({ changed: true, detail: "1 undated rows ignored" });
    expect(listingsOf(again).map((listing) => listing.url)).toEqual(first.map((listing) => listing.url));
  });

  test("dates count back from the fetch, and week ages count their far end", async () => {
    const days = Object.fromEntries(
      listingsOf(await feed("/README.md").fetchListings(context())).map((listing) => [listing.company, listing.postedDay]),
    );
    expect(days).toMatchObject({
      Nike: "2026-09-29",
      Waymo: "2026-09-28",
      Hermeus: "2026-09-28",
      "General Motors": "2026-09-23",
      Symbotic: "2026-09-16",
    });
    expect(days["D. E. Shaw"]).toBeUndefined();
  });

  test("only the title decides software, since the sections are broad", async () => {
    const software = Object.fromEntries(
      listingsOf(await feed("/README.md").fetchListings(context())).map((listing) => [listing.company, listing.software]),
    );
    // Nike's "Systems Engineer Graduate Internship" is in the Software Engineering section.
    expect(software).toMatchObject({ Waymo: true, Hermeus: true, Moog: true, Nike: false, Moderna: false });
  });

  test("a link back to zapply's own pages leads to no job, and is not followed again", async () => {
    dead.add("oracle-onsemi-2506290");
    try {
      const source = feed("/README.md");
      const result = await source.fetchListings(context());
      expect(result).toMatchObject({ detail: "7 new links resolved, 1 lead to no job, 1 undated rows ignored" });
      expect(listingsOf(result).map((listing) => listing.company)).not.toContain("onsemi");
      const before = linkRequests.length;
      await source.fetchListings(context(listingsOf(result)));
      expect(linkRequests.length).toBe(before);
    } finally {
      dead.clear();
    }
  });

  test("links that all lead to no job are not a failure", async () => {
    for (const slug of ["workday-nike-nke-R-94431", MOOG, "greenhouse-waymo-8234670"]) dead.add(slug);
    try {
      const stored = listingsOf(await feed("/README.md").fetchListings(context())).filter(
        (listing) => !dead.has(listing.sourceId),
      );
      expect(stored).toHaveLength(5);
      const result = await feed("/README.md").fetchListings(context(stored));
      expect(result).toMatchObject({ detail: "3 lead to no job, 1 undated rows ignored" });
    } finally {
      dead.clear();
    }
  });

  test("a link that fails is left out and tried again next run", async () => {
    failing.add("oracle-onsemi-2506290");
    try {
      const result = await feed("/README.md").fetchListings(context());
      expect(result).toMatchObject({
        detail: "7 new links resolved, 1 failed, 1 undated rows ignored",
        etag: undefined,
      });
      const before = linkRequests.length;
      await feed("/README.md").fetchListings(context(listingsOf(result)));
      expect(linkRequests.slice(before)).toEqual(["oracle-onsemi-2506290"]);
    } finally {
      failing.clear();
    }
  });

  test("throws when no new link resolves", async () => {
    await expect(feed("/README.md", { links: "/down/" }).fetchListings(context())).rejects.toThrow(
      "none of 8 new zapply links resolved",
    );
  });

  test("follows at most 150 new links per run, newest first", async () => {
    const result = await feed("/many.md").fetchListings(context());
    // The ETag is held back, so the next run reads the README again and follows the rest.
    expect(result).toMatchObject({
      detail: "150 new links resolved, 18 left for the next run, 1 undated rows ignored",
      etag: undefined,
    });
    expect(listingsOf(result).map((listing) => listing.company)).toContain("Nike");
    expect(listingsOf(result).map((listing) => listing.company)).not.toContain("Symbotic");
  });

  test("304 means unchanged", async () => {
    expect(await feed("/README.md").fetchListings(context([], ETAG))).toEqual({ changed: false });
  });

  test("throws on fewer than minRows rows", async () => {
    await expect(feed("/README.md", { minRows: 10 }).fetchListings(context())).rejects.toThrow(
      "only 9 rows, expected at least 10",
    );
  });

  test("fails when more than 5% of rows have no link or readable age", async () => {
    await expect(feed("/unreadable.md").fetchListings(context())).rejects.toThrow("2 of 9 rows");
  });

  test("HTTP errors fail the feed", async () => {
    await expect(feed("/gone.md").fetchListings(context())).rejects.toBeInstanceOf(HttpError);
  });
});
