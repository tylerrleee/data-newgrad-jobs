import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { canonicalKey } from "../src/canonical.ts";
import { openDb, rekeyIfCanonicalChanged, setMeta } from "../src/db.ts";
import { ingest } from "../src/ingest.ts";
import { ecr, listing, simplify, speedyapply } from "./helpers.ts";

const now = new Date("2026-09-24T20:00:00Z");
const later = new Date("2026-09-25T20:00:00Z");

let db: Database;
beforeEach(() => {
  db = openDb(":memory:");
});

function jobs() {
  return db.query<Record<string, unknown>, []>("SELECT * FROM jobs ORDER BY id").all();
}

describe("ingest", () => {
  test("the same job from two sources with different URLs becomes one job", () => {
    ingest(db, simplify, [
      listing({
        sourceId: "uuid-1",
        url: "https://jobs.ashbyhq.com/grow-therapy/92bfe88a-0000-4000-8000-000000000001/application?embed=true",
        title: "Software Engineer Intern",
        locations: ["NYC"],
      }),
    ], { complete: false, now });
    const stats = ingest(db, ecr, [
      listing({
        sourceId: "job_1",
        url: "https://jobs.ashbyhq.com/grow-therapy/92bfe88a-0000-4000-8000-000000000001",
        title: "Software Engineer Intern, Summer 2027",
        locations: ["New York, NY", "Remote"],
      }),
    ], { complete: false, now: later });

    expect(stats.newJobs).toBe(0);
    const [job] = jobs();
    expect(jobs()).toHaveLength(1);
    expect(job!.title).toBe("Software Engineer Intern, Summer 2027"); // the employer's title wins
    expect(JSON.parse(job!.sources as string)).toEqual(["simplify", "ecr"]);
    expect(JSON.parse(job!.locations as string)).toEqual(["NYC"]); // Simplify's tidier list
  });

  test("duplicates within one source become one job", () => {
    ingest(db, ecr, [
      listing({ sourceId: "job_a", url: "https://bah.wd1.myworkdayjobs.com/en-US/BAH_Jobs/job/McLean-VA/Intern_R0249827" }),
      listing({ sourceId: "job_b", url: "https://bah.wd1.myworkdayjobs.com/bah_jobs/job/McLean-VA/Intern_R0249827", company: "Booz Allen" }),
    ], { complete: true, now });
    expect(jobs()).toHaveLength(1);
  });

  test("ingesting the same data again changes nothing", () => {
    const batch = [listing({ sourceId: "s1", url: "https://job-boards.greenhouse.io/acme/jobs/1234567" })];
    ingest(db, simplify, batch, { complete: true, now });
    const before = jobs();
    const stats = ingest(db, simplify, batch, { complete: true, now: later });
    expect(stats.newJobs).toBe(0);
    expect(stats.deactivated).toBe(0);
    expect(jobs()).toEqual(before);
  });

  test("a listing missing from a complete snapshot becomes inactive and rejoins its job when it returns", () => {
    const a = listing({ sourceId: "a", url: "https://job-boards.greenhouse.io/acme/jobs/1" });
    const others = Array.from({ length: 9 }, (_, i) =>
      listing({ sourceId: `o${i}`, url: `https://job-boards.greenhouse.io/acme/jobs/${100 + i}` }),
    );
    ingest(db, speedyapply, [a, ...others], { complete: true, now });
    const partial = ingest(db, speedyapply, others, { complete: false, now: later });
    expect(partial.deactivated).toBe(0);

    const complete = ingest(db, speedyapply, others, { complete: true, now: later });
    expect(complete.deactivated).toBe(1);
    expect(jobs()[0]!.active).toBe(0);

    const back = ingest(db, speedyapply, [a, ...others], { complete: true, now: new Date("2026-09-26T20:00:00Z") });
    expect(back.newJobs).toBe(0);
    expect(jobs()[0]!.active).toBe(1);
  });

  test("a complete snapshot missing too many listings deactivates nothing", () => {
    const all = Array.from({ length: 10 }, (_, i) =>
      listing({ sourceId: `l${i}`, url: `https://job-boards.greenhouse.io/acme/jobs/${i + 1}` }),
    );
    ingest(db, ecr, all, { complete: true, now });
    const stats = ingest(db, ecr, all.slice(0, 5), { complete: true, now: later });
    expect(stats.guarded).toBe(true);
    expect(stats.deactivated).toBe(0);
  });

  describe("reposts", () => {
    const url = "https://roberthalf.wd1.myworkdayjobs.com/en-US/RobertHalfCareers/job/Remote/Tech-Intern_JR-258932";

    test("a requisition reposted 30+ days after its old listing closed is a new job", () => {
      ingest(db, simplify, [listing({ sourceId: "old", url: `${url}-3`, postedDay: "2026-02-23", active: false })], {
        complete: false,
        now,
      });
      const stats = ingest(db, simplify, [listing({ sourceId: "new", url, postedDay: "2026-08-31" })], {
        complete: false,
        now: later,
      });
      expect(stats.reposts).toBe(1);
      expect(jobs()).toHaveLength(2);

      // Later listings of the requisition join the newest job.
      ingest(db, ecr, [listing({ sourceId: "job_x", url, postedDay: "2026-09-01" })], { complete: false, now: later });
      expect(jobs()).toHaveLength(2);
      expect(db.query("SELECT job_id FROM listings WHERE source_id = 'job_x'").get()).toEqual({ job_id: 2 });
    });

    test("a new listing of a job that is still open is the same job, however new", () => {
      ingest(db, simplify, [listing({ sourceId: "old", url, postedDay: "2026-08-10" })], { complete: false, now });
      const stats = ingest(db, simplify, [listing({ sourceId: "dup", url, postedDay: "2026-09-24" })], {
        complete: false,
        now: later,
      });
      expect(stats.reposts).toBe(0);
      expect(jobs()).toHaveLength(1);
    });

    test("less than 30 days after closing is the same job", () => {
      ingest(db, simplify, [listing({ sourceId: "old", url, postedDay: "2026-09-01", active: false })], {
        complete: false,
        now,
      });
      ingest(db, simplify, [listing({ sourceId: "new", url, postedDay: "2026-09-24" })], { complete: false, now: later });
      expect(jobs()).toHaveLength(1);
    });

    test("a listing earlier in the same batch counts when deciding on a repost", () => {
      ingest(db, simplify, [listing({ sourceId: "old", url, postedDay: "2026-08-10", active: false })], {
        complete: false,
        now,
      });
      const stats = ingest(db, simplify, [
        listing({ sourceId: "mid", url, postedDay: "2026-09-05" }),
        listing({ sourceId: "new", url, postedDay: "2026-09-25" }),
      ], { complete: false, now: later });
      expect(stats.reposts).toBe(0);
      expect(jobs()).toHaveLength(1);
    });

    test("an existing listing whose date moves never starts a new job", () => {
      ingest(db, simplify, [listing({ sourceId: "s1", url, postedDay: "2026-06-01", active: false })], {
        complete: false,
        now,
      });
      ingest(db, ecr, [listing({ sourceId: "e1", url, postedDay: "2026-06-01", active: false })], { complete: false, now });
      ingest(db, simplify, [listing({ sourceId: "s2", url, postedDay: "2026-09-24" })], { complete: false, now: later });
      expect(jobs()).toHaveLength(2);
      // ECR later reports a new date for its old listing: it stays where it was.
      ingest(db, ecr, [listing({ sourceId: "e1", url, postedDay: "2026-09-24" })], { complete: false, now: later });
      expect(jobs()).toHaveLength(2);
      expect(db.query("SELECT job_id, posted_day FROM listings WHERE source_id = 'e1'").get()).toEqual({
        job_id: 1,
        posted_day: "2026-06-01",
      });
    });
  });

  test("after a large drop, listings missing for over two days still go inactive", () => {
    const all = Array.from({ length: 10 }, (_, i) =>
      listing({ sourceId: `l${i}`, url: `https://job-boards.greenhouse.io/acme/jobs/${i + 1}` }),
    );
    ingest(db, ecr, all, { complete: true, now });
    ingest(db, ecr, all.slice(0, 5), { complete: true, now: later });
    const stats = ingest(db, ecr, all.slice(0, 5), { complete: true, now: new Date("2026-09-27T20:00:00Z") });
    expect(stats).toMatchObject({ guarded: true, deactivated: 5 });
    expect(jobs().filter((job) => job.active === 0)).toHaveLength(5);
  });

  test("a changed canonical version rekeys stored listings without new jobs", () => {
    const url = "https://bah.wd1.myworkdayjobs.com/en-US/BAH_Jobs/job/McLean-VA/Intern_R0249827";
    ingest(db, ecr, [listing({ sourceId: "job_1", url })], { complete: false, now });
    db.run("UPDATE listings SET key = 'old:key'");
    setMeta(db, "canonical_version", "0");
    expect(rekeyIfCanonicalChanged(db)).toBe(1);
    expect(db.query("SELECT key FROM listings").get()).toEqual({ key: canonicalKey(url) });
    expect(rekeyIfCanonicalChanged(db)).toBe(0);
    ingest(db, simplify, [listing({ sourceId: "s1", url: url.replace("/en-US/BAH_Jobs/", "/bah_jobs/") })], {
      complete: false,
      now: later,
    });
    expect(jobs()).toHaveLength(1);
  });

  test("generic keys only merge listings from the same company", () => {
    const url = "https://careers.example.com/openings/software-intern";
    ingest(db, ecr, [listing({ sourceId: "e1", url, company: "Example Corp" })], { complete: false, now });
    ingest(db, simplify, [listing({ sourceId: "s1", url, company: "Example" })], { complete: false, now });
    ingest(db, speedyapply, [listing({ sourceId: url, url, company: "Different Co" })], { complete: false, now });
    expect(jobs()).toHaveLength(2);
  });

  test("relevance needs a software listing and no new-grad listing", () => {
    ingest(db, simplify, [
      listing({ sourceId: "s1", url: "https://job-boards.greenhouse.io/acme/jobs/1", software: false }),
      listing({ sourceId: "s2", url: "https://job-boards.greenhouse.io/acme/jobs/2", software: false }),
    ], { complete: false, now });
    ingest(db, ecr, [
      listing({ sourceId: "e1", url: "https://job-boards.greenhouse.io/acme/jobs/1" }),
      listing({ sourceId: "e2", url: "https://job-boards.greenhouse.io/acme/jobs/2", internship: false }),
    ], { complete: false, now });
    expect(jobs().map((job) => job.relevant)).toEqual([1, 0]);
  });

  test("the earliest posted day wins, and a listing's own day never moves later", () => {
    const url = "https://job-boards.greenhouse.io/acme/jobs/1";
    ingest(db, speedyapply, [listing({ sourceId: url, url, postedDay: "2026-09-23" })], { complete: false, now });
    ingest(db, speedyapply, [listing({ sourceId: url, url, postedDay: "2026-09-24" })], { complete: false, now: later });
    ingest(db, simplify, [listing({ sourceId: "s", url, postedDay: "2026-09-24" })], { complete: false, now: later });
    expect(jobs()[0]).toMatchObject({ posted_day: "2026-09-23", last_posted_day: "2026-09-24" });
  });
});
