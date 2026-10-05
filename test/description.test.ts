import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db.ts";
import { describePending, endpoint, htmlToText, type Description } from "../src/description.ts";
import { HttpError } from "../src/http.ts";
import { ingest } from "../src/ingest.ts";
import type { Log } from "../src/log.ts";
import { ecr, listing, simplify } from "./helpers.ts";

const silent: Log = { info() {}, warn() {}, error() {} };

describe("htmlToText", () => {
  test("puts paragraphs, headings and list items on their own lines", () => {
    const html =
      "<h3>Requirements</h3><p>You&#39;ll need:</p><ul><li>3+ years of SQL</li><li>Python &amp; R</li></ul>" +
      "<p><strong>Nice to have</strong><br>Spark&nbsp;experience</p><style>p { color: red }</style>";
    expect(htmlToText(html)).toBe(
      "Requirements\nYou'll need:\n- 3+ years of SQL\n- Python & R\nNice to have\nSpark experience",
    );
  });

  test("keeps a list item's dash with its paragraph", () => {
    expect(htmlToText("<p>Desired:</p><ul><li><p>SQL</p></li><li><p>Spark</p></li></ul>")).toBe("Desired:\n- SQL\n- Spark");
  });
});

describe("endpoint", () => {
  test("Greenhouse boards, and company sites once the board is known", () => {
    const board = endpoint("https://job-boards.greenhouse.io/acme/jobs/4324855009");
    expect(board?.url).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs/4324855009");
    expect(board?.read(JSON.stringify({ content: "&lt;p&gt;2+ years of experience&lt;/p&gt;" }))).toBe(
      "2+ years of experience",
    );
    expect(endpoint("https://www.acme.com/careers/8843495002?gh_jid=8843495002")).toBeUndefined();
    expect(endpoint("https://www.acme.com/careers/8843495002?gh_jid=8843495002", "acme")?.url).toBe(
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/8843495002",
    );
  });

  test("Lever, including its lists and the EU site", () => {
    const id = "6ed76ce8-4156-4b60-b120-403538bd66cd";
    const lever = endpoint(`https://jobs.lever.co/acme/${id}/apply`);
    expect(lever?.url).toBe(`https://api.lever.co/v0/postings/acme/${id}`);
    const body = {
      descriptionPlain: "About the role",
      lists: [{ text: "What We Require", content: "<li>3+ years of experience</li>" }],
      additionalPlain: "Benefits",
    };
    expect(lever?.read(JSON.stringify(body))).toBe("About the role\nWhat We Require\n- 3+ years of experience\nBenefits");
    expect(endpoint(`https://jobs.eu.lever.co/acme/${id}`)?.url).toBe(`https://api.eu.lever.co/v0/postings/acme/${id}`);
  });

  test("Ashby picks the job out of its board", () => {
    const id = "f718bcfe-3f5b-4682-a294-697499caf813";
    const ashby = endpoint(`https://jobs.ashbyhq.com/acme/${id}`);
    expect(ashby?.url).toBe("https://api.ashbyhq.com/posting-api/job-board/acme");
    const board = { jobs: [{ id: "other", descriptionHtml: "<p>no</p>" }, { id, descriptionHtml: "<p>yes</p>" }] };
    expect(ashby?.read(JSON.stringify(board))).toBe("yes");
    expect(ashby?.read(JSON.stringify({ jobs: [] }))).toBeUndefined();
  });

  test("Workday, with or without a locale and an apply step", () => {
    const path = "job/USA-NC-Cary/Data-Analyst_JR00047125";
    const api = `https://abb.wd3.myworkdayjobs.com/wday/cxs/abb/external_career_page/${path}`;
    expect(endpoint(`https://abb.wd3.myworkdayjobs.com/external_career_page/${path}`)?.url).toBe(api);
    expect(endpoint(`https://abb.wd3.myworkdayjobs.com/en-US/external_career_page/${path}/apply`)?.url).toBe(api);
    const workday = endpoint(`https://abb.wd3.myworkdayjobs.com/external_career_page/${path}`);
    expect(workday?.read(JSON.stringify({ jobPostingInfo: { jobDescription: "<p>Hi</p>" } }))).toBe("Hi");
  });

  test("other sites aren't read", () => {
    expect(endpoint("https://careers-acme.icims.com/jobs/12345/data-analyst/job")).toBeUndefined();
    expect(endpoint("not a url")).toBeUndefined();
  });
});

describe("describePending", () => {
  let db: Database;
  const now = new Date("2026-09-24T20:00:00Z");
  beforeEach(() => {
    db = openDb(":memory:");
  });

  function stored() {
    return db.query<{ job_id: number; status: string; text: string | null }, []>(
      "SELECT job_id, status, text FROM descriptions ORDER BY job_id",
    ).all();
  }

  test("reads each job that may be posted once, with all its URLs", async () => {
    ingest(db, simplify, [
      listing({ sourceId: "a", url: "https://job-boards.greenhouse.io/acme/jobs/1" }),
      listing({ sourceId: "b", url: "https://job-boards.greenhouse.io/acme/jobs/2", roleMatch: false }),
      listing({ sourceId: "c", url: "https://job-boards.greenhouse.io/acme/jobs/3", postedDay: "2026-09-01" }),
      listing({ sourceId: "d", url: "https://job-boards.greenhouse.io/acme/jobs/4", title: "Data Scientist, PhD" }),
    ], { complete: false, now });
    ingest(db, ecr, [listing({ sourceId: "e", url: "https://acme.com/careers/1?gh_jid=1" })], { complete: false, now });

    const calls: string[][] = [];
    const fetch = async (urls: string[]): Promise<Description> => {
      calls.push(urls);
      return { status: "ok", text: "2+ years of experience" };
    };
    await describePending(db, { now, since: "2026-09-20", postInternational: false, log: silent, fetch, paceMs: 0 });
    // The URL shown (ECR's) first, then the job's other URLs.
    expect(calls).toEqual([["https://acme.com/careers/1?gh_jid=1", "https://job-boards.greenhouse.io/acme/jobs/1"]]);
    expect(stored()).toEqual([{ job_id: 1, status: "ok", text: "2+ years of experience" }]);

    await describePending(db, { now, since: "2026-09-20", postInternational: false, log: silent, fetch, paceMs: 0 });
    expect(calls).toHaveLength(1);
  });

  test("a failed fetch is tried again next run, a refused one isn't", async () => {
    ingest(db, simplify, [listing({ sourceId: "a", url: "https://job-boards.greenhouse.io/acme/jobs/1" })], {
      complete: false,
      now,
    });
    const failing = async (): Promise<Description> => {
      throw new Error("timeout");
    };
    await describePending(db, { now, since: "2026-09-20", postInternational: false, log: silent, fetch: failing, paceMs: 0 });
    expect(stored()).toEqual([]);
    const refused = async (): Promise<Description> => {
      throw new HttpError("https://boards-api.greenhouse.io/v1/boards/acme/jobs/1", 403);
    };
    await describePending(db, { now, since: "2026-09-20", postInternational: false, log: silent, fetch: refused, paceMs: 0 });
    expect(stored()).toEqual([{ job_id: 1, status: "unavailable", text: null }]);
  });
});
