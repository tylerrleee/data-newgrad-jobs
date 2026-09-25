import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { feedState, openDb, setAlerted } from "../src/db.ts";
import { runFeeds } from "../src/feeds.ts";
import { HttpError } from "../src/http.ts";
import type { FetchContext, FetchResult, JobSource } from "../src/job.ts";
import { listing } from "./helpers.ts";

const start = new Date("2026-09-24T16:45:00Z");
const minutes = (n: number) => new Date(start.getTime() + n * 60_000);

let db: Database;
beforeEach(() => {
  db = openDb(":memory:");
});

function source(
  name: string,
  fetch: (ctx: FetchContext) => Promise<FetchResult> | FetchResult,
  minIntervalMinutes = 20,
): JobSource & { contexts: FetchContext[] } {
  const contexts: FetchContext[] = [];
  return {
    name,
    source: "simplify",
    minIntervalMinutes,
    contexts,
    async fetchListings(ctx) {
      contexts.push(ctx);
      return fetch(ctx);
    },
  };
}

const quiet = () => {};
const changed = (etag?: string): FetchResult => ({
  changed: true,
  listings: [listing({ sourceId: "s1", url: "https://job-boards.greenhouse.io/acme/jobs/1" })],
  complete: false,
  etag,
  skipped: 0,
});

describe("runFeeds", () => {
  test("skips a feed until its interval has passed, and passes its ETag back", async () => {
    const feed = source("simplify", () => changed('"v1"'));
    await runFeeds(db, [feed], start, quiet);
    await runFeeds(db, [feed], minutes(10), quiet);
    await runFeeds(db, [feed], minutes(20), quiet);
    expect(feed.contexts).toHaveLength(2);
    expect(feed.contexts[1]!.etag).toBe('"v1"');
    expect(feed.contexts[1]!.lastSuccessAt).toEqual(start);
  });

  test("one failing feed doesn't stop the others", async () => {
    const broken = source("broken", () => {
      throw new Error("boom");
    });
    const working = source("working", () => changed());
    const result = await runFeeds(db, [broken, working], start, quiet);
    expect(result.failed).toBe(true);
    expect(working.contexts).toHaveLength(1);
    expect(db.query("SELECT count(*) AS n FROM listings").get()).toEqual({ n: 1 });
  });

  test("backs off exponentially, honours Retry-After, and waits a day on 404", async () => {
    const failing = source("failing", () => {
      throw new HttpError("https://x", 503, 3600);
    });
    await runFeeds(db, [failing], start, quiet);
    expect(feedState(db, "failing").nextAttemptAt).toEqual(minutes(60));
    await runFeeds(db, [failing], minutes(60), quiet);
    expect(feedState(db, "failing").nextAttemptAt).toEqual(minutes(60 + 60));

    const gone = source("gone", () => {
      throw new HttpError("https://x", 404);
    });
    await runFeeds(db, [gone], start, quiet);
    expect(feedState(db, "gone").nextAttemptAt).toEqual(minutes(24 * 60));

    const flaky = source("flaky", () => {
      throw new Error("timeout");
    });
    for (const at of [0, 20, 60]) await runFeeds(db, [flaky], minutes(at), quiet);
    expect(feedState(db, "flaky")).toMatchObject({ failures: 3, nextAttemptAt: minutes(60 + 80) });
  });

  test("alerts once after repeated failures and once on recovery, counting only delivered alerts", async () => {
    let fail = true;
    const feed = source("ecr", () => {
      if (fail) throw new Error("HTTP 403");
      return { changed: false };
    });
    let at = 0;
    const run = async () => {
      const { alerts } = await runFeeds(db, [feed], minutes(at), quiet);
      at += 24 * 60;
      return alerts;
    };
    expect(await run()).toEqual([]);
    expect(await run()).toEqual([]);
    const [first] = await run();
    expect(first).toMatchObject({ feed: "ecr", alerted: true });
    expect(first!.text).toContain("failed 3 times");
    // Not delivered (a dry run, or Slack was down): the next run alerts again.
    expect(await run()).toHaveLength(1);
    setAlerted(db, "ecr", true);
    expect(await run()).toEqual([]);

    fail = false;
    const [recovered] = await run();
    expect(recovered).toMatchObject({ feed: "ecr", alerted: false });
    expect(recovered!.text).toContain("working again");
    setAlerted(db, "ecr", false);
    expect(await run()).toEqual([]);
    expect(feedState(db, "ecr")).toMatchObject({ failures: 0, alerted: false });
  });

  test("an unchanged result can schedule the next check", async () => {
    const tomorrow = minutes(19 * 60);
    const feed = source("speedyapply", () => ({ changed: false, nextAttemptAt: tomorrow }));
    await runFeeds(db, [feed], start, quiet);
    expect(feedState(db, "speedyapply").nextAttemptAt).toEqual(tomorrow);
    await runFeeds(db, [feed], minutes(60), quiet);
    expect(feed.contexts).toHaveLength(1);
  });

  test("an ingest failure keeps the old ETag so the next run refetches", async () => {
    const feed = source("simplify", () => ({ ...changed('"v2"'), listings: [{ bad: true } as never] }));
    const result = await runFeeds(db, [feed], start, quiet);
    expect(result.failed).toBe(true);
    expect(feedState(db, "simplify").etag).toBeUndefined();
    expect(db.query("SELECT count(*) AS n FROM jobs").get()).toEqual({ n: 0 });
  });

  test("storedRaw looks up this feed's listings", async () => {
    const feed = source("simplify", () => changed());
    await runFeeds(db, [feed], start, quiet);
    await runFeeds(db, [feed], minutes(20), quiet);
    expect(feed.contexts[1]!.storedRaw("s1")).toBe(JSON.stringify({ id: "s1" }));
    expect(feed.contexts[1]!.storedRaw("nope")).toBeUndefined();
  });
});
