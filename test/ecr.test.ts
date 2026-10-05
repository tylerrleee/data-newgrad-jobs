import { afterAll, describe, expect, test } from "bun:test";
import type { FetchContext, JobSource, Listing } from "../src/job.ts";
import { ecrListing, ecrSource, extractInitialJobs } from "../src/sources/ecr.ts";

const html = await Bun.file(`${import.meta.dir}/fixtures/ecr.html`).text();
const partial = await Bun.file(`${import.meta.dir}/fixtures/ecr-partial.html`).text();

/** A page whose flight data is `pieces`, one push script each. */
function page(...pieces: string[]): string {
  return pieces.map((piece) => `<script>self.__next_f.push(${JSON.stringify([1, piece])})</script>`).join("");
}

function flight(jobs: unknown[], state = "live"): string {
  return `5:["$","$L15","summer-2027",{"initialJobs":${JSON.stringify(jobs)},"initialDataState":"${state}"}]\n`;
}

function byId(listings: (Listing | undefined)[]): Map<string, Listing> {
  return new Map(listings.filter((listing) => listing !== undefined).map((listing) => [listing.sourceId, listing]));
}

const { jobs } = extractInitialJobs(html);
const listings = byId(jobs.map(ecrListing));
const amazon = jobs.find((job) => (job as { id: string }).id === "job_24618ec4afaa0677") as Record<string, unknown>;

describe("extractInitialJobs", () => {
  test("joins the flight data of every push chunk", () => {
    expect(html.match(/self\.__next_f\.push\(\[1,/g)).toHaveLength(2);
    expect(html).not.toContain("University Graduate - Software");
    const result = extractInitialJobs(html);
    expect(result.dataState).toBe("live");
    expect(result.jobs).toHaveLength(14);
    expect(result.jobs[2]).toMatchObject({
      id: "job_f4b844cc4d77f30c",
      title: "2027 University Graduate - Software Engineer",
    });
  });

  test("reads a partial snapshot", () => {
    const result = extractInitialJobs(partial);
    expect(result.dataState).toBe("partial");
    expect(result.jobs).toHaveLength(12);
  });

  test("a ')</script>' inside a string does not end a chunk", () => {
    const title = 'Intern ])</script><script>self.__next_f.push([1,"x"])</script>';
    const text = flight([{ id: "job_1", title }]);
    const result = extractInitialJobs(page(text.slice(0, 20), text.slice(20)));
    expect(result.jobs).toEqual([{ id: "job_1", title }]);
  });

  test("skips bootstrap and binary chunks", () => {
    const text = flight([{ id: "job_1" }]);
    const at = text.indexOf("job_1");
    const bootstrap = "<script>(self.__next_f=self.__next_f||[]).push([0])</script>";
    const binary = '<script>self.__next_f.push([3,"AAEC"])</script>';
    const result = extractInitialJobs(bootstrap + page(text.slice(0, at)) + binary + page(text.slice(at)));
    expect(result.jobs).toEqual([{ id: "job_1" }]);
  });

  test("dataState is undefined when the page doesn't say", () => {
    expect(extractInitialJobs(page('5:{"initialJobs":[]}\n')).dataState).toBeUndefined();
  });

  test("throws when initialJobs is missing", () => {
    expect(() => extractInitialJobs("<html><body></body></html>")).toThrow(/initialJobs/);
    expect(() => extractInitialJobs(page('5:{"initialDataState":"live"}\n'))).toThrow(/initialJobs/);
    expect(() => extractInitialJobs(page('5:{"initialJobs":[{"id":"job_1"}'))).toThrow(/unterminated/);
  });
});

describe("ecrListing", () => {
  test("maps every field", () => {
    expect(listings.size).toBe(14);
    expect(listings.get("job_24618ec4afaa0677")).toEqual({
      sourceId: "job_24618ec4afaa0677",
      url: "https://amazon.jobs/en/jobs/10559746/software-development-engineer-intern-summer-2027-usa-amazon-dedicated-cloud-adc",
      key: "amazon:10559746",
      company: "Amazon",
      title: "Software Development Engineer Intern - Summer 2027 (USA) , Amazon Dedicated Cloud (ADC)",
      locations: ["Seattle, Washington, US"],
      category: "SWE",
      postedDay: "2026-09-24",
      roleMatch: false,
      entryLevel: false,
      active: true,
      raw: JSON.stringify(amazon),
    });
  });

  test("cleans a junk apply URL", () => {
    expect(listings.get("job_05489ee8d8645e89")).toMatchObject({
      url: "https://boards.greenhouse.io/figma/jobs/6143238004?gh_jid=6143238004",
      key: "gh:6143238004",
    });
  });

  test("without postedAt, uses the New York day of firstSeenAt", () => {
    // 2026-09-25 02:00:00+00 is 22:00 on the 24th in New York.
    expect(listings.get("job_00000000fade0001")?.postedDay).toBe("2026-09-24");
    expect(listings.get("job_a16a719c77cd89d5")?.postedDay).toBe("2026-09-23");
    expect(listings.get("job_64e6466e0662281e")).toMatchObject({
      postedDay: "2026-07-11",
      url: "https://stokespace.com/careers/current-openings?gh_jid=5987663004&jr_id=69fae0acd21cf86d1e3cd79c",
      key: "gh:5987663004",
    });
  });

  test("keeps new-grad titles as entry level and splits locations", () => {
    expect(listings.get("job_f4b844cc4d77f30c")).toMatchObject({
      roleMatch: false,
      entryLevel: true,
      locations: ["San, JOSE"],
    });
    expect(listings.get("job_fdbdd06f57a9f59d")?.locations).toEqual(["Cary, North Carolina, United States", "Cary, NC"]);
  });

  test("classifies by track and title", () => {
    expect(listings.get("job_cdece4455c021f31")).toMatchObject({ category: "Finance", roleMatch: false });
    expect(listings.get("job_869bff1fee6c15a4")).toMatchObject({ category: "ML & AI", roleMatch: false });
    expect(listings.get("job_fdbdd06f57a9f59d")).toMatchObject({ category: "Other", roleMatch: false });
    expect(listings.get("job_a16a719c77cd89d5")).toMatchObject({ category: "Data", roleMatch: true });
    expect(listings.get("job_08f3391d7785629e")).toMatchObject({ category: "Data", roleMatch: true });
  });

  test("cleans text and keys ECR's internal duplicates alike", () => {
    expect(listings.get("job_6c05a495fdff5827")?.title).toBe("Intern – Software Development - 8 months - Hybrid Ottawa");
    expect(listings.get("job_878afd5de19db6be")?.key).toBe("wd:bah:R0249827");
    expect(listings.get("job_1d2e66550140944a")?.key).toBe("wd:bah:R0249827");
  });

  test("skips jobs without an id, usable apply URL or date", () => {
    for (const change of [
      { id: undefined },
      { id: 7 },
      { applyUrl: undefined },
      { applyUrl: "" },
      { applyUrl: "mailto:jobs@example.com" },
      { postedAt: null, firstSeenAt: "yesterday" },
      { postedAt: null, firstSeenAt: null },
    ]) {
      expect(ecrListing({ ...amazon, ...change })).toBeUndefined();
    }
    for (const job of [null, "job", [amazon]]) expect(ecrListing(job)).toBeUndefined();
  });

  test("handles closed jobs, odd dates and missing fields", () => {
    expect(ecrListing({ ...amazon, closed: true })?.active).toBe(false);
    expect(ecrListing({ ...amazon, postedAt: "2026-09" })?.postedDay).toBe("2026-09-24");
    expect(ecrListing({ ...amazon, track: undefined, location: undefined })).toMatchObject({
      category: null,
      locations: [],
    });
    expect(ecrListing({ ...amazon, title: "$$5k Bonus Intern" })?.title).toBe("$5k Bonus Intern");
  });
});

describe("ecrSource", () => {
  const servers: ReturnType<typeof Bun.serve>[] = [];
  afterAll(() => {
    for (const server of servers) server.stop(true);
  });

  /** Serves `body` on localhost and records each request's headers. */
  function serve(body: string): { url: string; requests: Headers[] } {
    const requests: Headers[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(new Headers(request.headers));
        return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      },
    });
    servers.push(server);
    return { url: new URL("/new-grad", server.url).href, requests };
  }

  const ctx: FetchContext = {
    now: new Date("2026-09-24T23:30:00Z"),
    etag: undefined,
    lastSuccessAt: undefined,
    lastFullAt: undefined,
    storedRaw: () => undefined,
  };

  async function fetchChanged(source: JobSource) {
    const result = await source.fetchListings(ctx);
    if (!result.changed) throw new Error("expected a changed result");
    return result;
  }

  test("fetches the board with fixed headers", async () => {
    const { url, requests } = serve(html);
    const source = ecrSource(url, { minJobs: 1 });
    expect(source).toMatchObject({ name: "ecr-newgrad", source: "ecr", minIntervalMinutes: 55 });
    const result = await fetchChanged(source);
    expect(result).toMatchObject({ complete: true, skipped: 0, detail: "live" });
    expect(result.listings).toHaveLength(14);
    expect(result.etag).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.get("user-agent")).toBe("jobbo/0.1 (personal new-grad job alerts)");
    expect(requests[0]!.get("accept-encoding")).toBe("br, gzip");
  });

  test("a partial or unknown state is not complete", async () => {
    const partialResult = await fetchChanged(ecrSource(serve(partial).url, { minJobs: 1 }));
    expect(partialResult).toMatchObject({ complete: false, detail: "partial" });
    expect(partialResult.listings).toHaveLength(12);
    const unknown = await fetchChanged(ecrSource(serve(page('5:{"initialJobs":[]}\n')).url, { minJobs: 0 }));
    expect(unknown).toMatchObject({ complete: false, detail: "unknown" });
  });

  test("throws on fewer than minJobs jobs", async () => {
    await expect(ecrSource(serve(html).url).fetchListings(ctx)).rejects.toThrow(/only 14 jobs/);
  });

  test("throws when initialJobs is missing", async () => {
    await expect(ecrSource(serve("<html></html>").url, { minJobs: 0 }).fetchListings(ctx)).rejects.toThrow(/initialJobs/);
  });

  test("throws when more than 5% of jobs are unusable", async () => {
    const job = (i: number, bad: number) => ({ ...amazon, id: `job_${i}`, applyUrl: i < bad ? "" : amazon.applyUrl });
    const board = (bad: number) => page(flight(Array.from({ length: 20 }, (_, i) => job(i, bad))));
    const ok = await fetchChanged(ecrSource(serve(board(1)).url, { minJobs: 1 }));
    expect(ok.skipped).toBe(1);
    expect(ok.listings).toHaveLength(19);
    await expect(ecrSource(serve(board(2)).url, { minJobs: 1 }).fetchListings(ctx)).rejects.toThrow(/2 of 20 jobs/);
  });
});
