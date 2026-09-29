import type { Database } from "bun:sqlite";
import { WebAPIPlatformError, WebAPIRateLimitedError, WebAPIRequestError } from "@slack/web-api";
import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db.ts";
import { ingest } from "../src/ingest.ts";
import { markPosted, postPending, requeue, type PostOptions } from "../src/post.ts";
import type { JobMessage, SlackPoster } from "../src/slack.ts";
import { ecr, listing, simplify } from "./helpers.ts";

interface Call {
  kind: "post" | "update" | "text";
  message?: JobMessage;
  threadTs?: string;
  ts?: string;
}

function fakePoster(
  fail?: (message: JobMessage, threadTs?: string) => unknown,
  failUpdate?: () => unknown,
): SlackPoster & { calls: Call[] } {
  const calls: Call[] = [];
  let count = 0;
  return {
    calls,
    async post(message, threadTs) {
      const error = fail?.(message, threadTs);
      if (error) throw error;
      const ts = `100.${++count}`;
      calls.push({ kind: "post", message, threadTs, ts });
      return ts;
    },
    async update(ts, message) {
      const error = failUpdate?.();
      if (error) throw error;
      calls.push({ kind: "update", message, ts });
    },
    async postText() {
      calls.push({ kind: "text" });
    },
  };
}

const day1 = new Date("2026-09-24T20:00:00Z");
const day2 = new Date("2026-09-25T20:00:00Z");
const options = (now: Date, extra: Partial<PostOptions> = {}): PostOptions => ({
  channel: "C1",
  now,
  postSince: "2026-09-24",
  maxPosts: 40,
  paceMs: 0,
  ...extra,
});

let db: Database;
beforeEach(() => {
  db = openDb(":memory:");
});

function greenhouse(id: number, overrides: Parameters<typeof listing>[0] extends infer T ? Partial<T> : never = {}) {
  return listing({ sourceId: `s${id}`, url: `https://job-boards.greenhouse.io/acme/jobs/${id}`, ...overrides });
}

function states() {
  return db.query<{ id: number; post_state: string }, []>("SELECT id, post_state FROM jobs ORDER BY id").all();
}

describe("postPending", () => {
  test("posts new jobs once, and never the backlog", async () => {
    ingest(db, simplify, [
      greenhouse(1, { postedDay: "2026-09-24" }),
      greenhouse(2, { postedDay: "2026-09-10", title: "Old Intern" }),
      greenhouse(3, { postedDay: "2026-09-24", software: false, title: "Marketing Intern" }),
    ], { complete: false, now: day1 });

    const poster = fakePoster();
    const summary = await postPending(db, poster, options(day1));
    expect(summary).toMatchObject({ decided: 2, expired: 1, eligible: 1, posted: 1 });
    expect(poster.calls.map((call) => call.message?.title)).toEqual(["Software Engineer Intern"]);
    expect(poster.calls[0]!.message!.sources).toEqual(["Simplify"]);

    const again = fakePoster();
    await postPending(db, again, options(day2));
    expect(again.calls).toHaveLength(0);
  });

  test("a backlog job stays expired when a later listing makes it look new", async () => {
    ingest(db, simplify, [greenhouse(1, { postedDay: "2026-09-01" })], { complete: false, now: day1 });
    await postPending(db, fakePoster(), options(day1));
    // speedyapply-style late dating of the same job.
    ingest(db, ecr, [greenhouse(1, { sourceId: "job_1", postedDay: "2026-09-25" })], { complete: false, now: day2 });
    const poster = fakePoster();
    await postPending(db, poster, options(day2));
    expect(poster.calls).toHaveLength(0);
  });

  test("a fresh job deferred by the cap is still posted after its date moves earlier", async () => {
    ingest(db, simplify, [greenhouse(1), greenhouse(2)], { complete: false, now: day1 });
    const first = fakePoster();
    const summary = await postPending(db, first, options(day1, { maxPosts: 1 }));
    expect(summary).toMatchObject({ posted: 1, deferred: 1 });

    ingest(db, ecr, [greenhouse(2, { sourceId: "job_2", postedDay: "2026-07-01" })], { complete: false, now: day2 });
    const second = fakePoster();
    await postPending(db, second, options(day2));
    expect(second.calls.map((call) => call.message?.url)).toEqual(["https://job-boards.greenhouse.io/acme/jobs/2"]);
  });

  test("look-alike openings go into one thread, including later arrivals", async () => {
    const lookalike = { company: "Booz Allen", title: "Software Developer Intern" };
    ingest(db, simplify, [greenhouse(1, lookalike), greenhouse(2, lookalike), greenhouse(3, lookalike)], {
      complete: false,
      now: day1,
    });
    const first = fakePoster();
    const summary = await postPending(db, first, options(day1));
    expect(summary).toMatchObject({ posted: 1, replies: 2, updated: 1 });
    const [parent, ...replies] = first.calls.filter((call) => call.kind === "post");
    expect(parent!.threadTs).toBeUndefined();
    expect(replies.map((call) => call.threadTs)).toEqual([parent!.ts, parent!.ts]);
    expect(first.calls.at(-1)).toMatchObject({ kind: "update", ts: parent!.ts, message: { moreInThread: 2 } });

    ingest(db, simplify, [greenhouse(4, { ...lookalike, postedDay: "2026-09-25" })], { complete: false, now: day2 });
    const second = fakePoster();
    await postPending(db, second, options(day2));
    expect(second.calls.map((call) => [call.kind, call.threadTs ?? call.ts])).toEqual([
      ["post", parent!.ts],
      ["update", parent!.ts],
    ]);
    expect(second.calls[1]!.message!.moreInThread).toBe(3);
  });

  test("openings more than 3 days apart start a new thread", async () => {
    const lookalike = { company: "Acme", title: "Data Science Intern" };
    ingest(db, simplify, [greenhouse(1, lookalike)], { complete: false, now: day1 });
    await postPending(db, fakePoster(), options(day1));
    const later = new Date("2026-09-29T20:00:00Z");
    ingest(db, simplify, [greenhouse(2, { ...lookalike, postedDay: "2026-09-29" })], { complete: false, now: later });
    const poster = fakePoster();
    await postPending(db, poster, options(later));
    expect(poster.calls[0]!.threadTs).toBeUndefined();
  });

  test("a rate limit puts the job back and stops the run", async () => {
    ingest(db, simplify, [greenhouse(1), greenhouse(2)], { complete: false, now: day1 });
    const poster = fakePoster(() => new WebAPIRateLimitedError(30));
    const summary = await postPending(db, poster, options(day1));
    expect(summary.stopped).toContain("rate-limit");
    expect(states().map((job) => job.post_state)).toEqual(["pending", "pending"]);
  });

  test("an invalid message fails that job and the run continues", async () => {
    ingest(db, simplify, [greenhouse(1, { title: "Bad" }), greenhouse(2)], { complete: false, now: day1 });
    const poster = fakePoster((message) =>
      message.title === "Bad" ? new WebAPIPlatformError({ ok: false, error: "invalid_blocks" }) : undefined,
    );
    const summary = await postPending(db, poster, options(day1));
    expect(summary).toMatchObject({ failed: 1, posted: 1 });
    expect(states().map((job) => job.post_state)).toEqual(["failed", "posted"]);
  });

  test("an error that may have posted leaves the job claimed until someone requeues it", async () => {
    ingest(db, simplify, [greenhouse(1), greenhouse(2)], { complete: false, now: day1 });
    const timeout = new WebAPIRequestError(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
    const summary = await postPending(db, fakePoster(() => timeout), options(day1));
    expect(summary.stopped).toBeDefined();
    expect(states().map((job) => job.post_state)).toEqual(["claimed", "pending"]);

    const next = fakePoster();
    const again = await postPending(db, next, options(day1));
    expect(again.claimed.map((job) => job.id)).toEqual([1]);
    expect(next.calls.filter((call) => call.kind === "post")).toHaveLength(1);

    expect(requeue(db, [1], day1).map((job) => job.id)).toEqual([1]);
    const last = fakePoster();
    await postPending(db, last, options(day1));
    expect(last.calls.filter((call) => call.kind === "post").map((call) => call.message?.url)).toEqual([
      "https://job-boards.greenhouse.io/acme/jobs/1",
    ]);
  });

  test("an opening whose thread won't take replies is posted on its own", async () => {
    const lookalike = { company: "Booz Allen", title: "Software Developer Intern" };
    ingest(db, simplify, [greenhouse(1, lookalike), greenhouse(2, lookalike)], { complete: false, now: day1 });
    const locked = new WebAPIPlatformError({ ok: false, error: "cannot_reply_to_message" });
    const poster = fakePoster((_message, threadTs) => (threadTs ? locked : undefined));
    const summary = await postPending(db, poster, options(day1));
    expect(summary).toMatchObject({ posted: 2, replies: 0, failed: 0 });
    expect(poster.calls.every((call) => call.threadTs === undefined)).toBe(true);
  });

  test("three rejected messages in a row stop the run", async () => {
    ingest(db, simplify, [1, 2, 3, 4, 5].map((id) => greenhouse(id, { title: `Software Intern ${id}` })), {
      complete: false,
      now: day1,
    });
    const rejected = new WebAPIPlatformError({ ok: false, error: "some_new_error" });
    const summary = await postPending(db, fakePoster(() => rejected), options(day1));
    expect(summary).toMatchObject({ failed: 3, deferred: 2 });
    expect(summary.stopped).toContain("rejected 3 messages in a row");
    expect(states().map((job) => job.post_state)).toEqual(["failed", "failed", "failed", "pending", "pending"]);
  });

  test("a requeued job gets a fresh week, however long it was claimed", async () => {
    ingest(db, simplify, [greenhouse(1)], { complete: false, now: day1 });
    const timeout = new WebAPIRequestError(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
    await postPending(db, fakePoster(() => timeout), options(day1));
    const later = new Date("2026-10-05T20:00:00Z");
    requeue(db, [1], later);
    const poster = fakePoster();
    await postPending(db, poster, options(later));
    expect(poster.calls.map((call) => call.kind)).toEqual(["post"]);
  });

  test("a claimed job confirmed as posted stops the warning and becomes a thread parent", async () => {
    const lookalike = { company: "Acme", title: "Data Science Intern" };
    ingest(db, simplify, [greenhouse(1, lookalike)], { complete: false, now: day1 });
    const timeout = new WebAPIRequestError(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
    await postPending(db, fakePoster(() => timeout), options(day1));
    expect(markPosted(db, 1, "C1", "123.456")?.id).toBe(1);
    expect(markPosted(db, 1, "C1", "123.456")).toBeUndefined();

    ingest(db, simplify, [greenhouse(2, lookalike)], { complete: false, now: day2 });
    const poster = fakePoster();
    const summary = await postPending(db, poster, options(day2));
    expect(summary.claimed).toEqual([]);
    expect(poster.calls[0]).toMatchObject({ kind: "post", threadTs: "123.456" });
  });

  test("a parent Slack won't update is counted and not retried", async () => {
    const lookalike = { company: "Acme", title: "Data Science Intern" };
    ingest(db, simplify, [greenhouse(1, lookalike), greenhouse(2, lookalike)], { complete: false, now: day1 });
    const gone = new WebAPIPlatformError({ ok: false, error: "message_not_found" });
    const summary = await postPending(db, fakePoster(undefined, () => gone), options(day1));
    expect(summary).toMatchObject({ replies: 1, updated: 0, notUpdated: 1 });
    expect(summary.stopped).toBeUndefined();
    const again = fakePoster();
    await postPending(db, again, options(day1));
    expect(again.calls).toHaveLength(0);
  });

  test("a connection that never reached Slack puts the job back", async () => {
    ingest(db, simplify, [greenhouse(1)], { complete: false, now: day1 });
    const refused = new WebAPIRequestError(Object.assign(new TypeError("Unable to connect"), { code: "ConnectionRefused" }));
    await postPending(db, fakePoster(() => refused), options(day1));
    expect(states()[0]!.post_state).toBe("pending");
  });

  test("inactive and non-internship jobs are not posted", async () => {
    ingest(db, simplify, [greenhouse(1, { active: false }), greenhouse(2, { internship: false })], {
      complete: false,
      now: day1,
    });
    const poster = fakePoster();
    const summary = await postPending(db, poster, options(day1));
    expect(summary.eligible).toBe(0);
    expect(poster.calls).toHaveLength(0);
  });

  test("jobs only outside the US are held back unless international posting is on", async () => {
    ingest(db, simplify, [
      greenhouse(1, { locations: ["Toronto, ON, Canada"] }),
      greenhouse(2, { title: "Backend Intern", locations: ["Toronto, ON, Canada", "New York, NY"] }),
      greenhouse(3, { title: "Remote Intern", locations: ["Remote"] }),
    ], { complete: false, now: day1 });
    // Another source lists job 1 at the same apply URL; its locations count too.
    ingest(db, ecr, [greenhouse(1, { sourceId: "job_1", locations: ["Singapore"] })], { complete: false, now: day1 });

    const poster = fakePoster();
    const summary = await postPending(db, poster, options(day1));
    expect(summary).toMatchObject({ international: 1, eligible: 2, posted: 2 });
    expect(poster.calls.map((call) => call.message?.title)).toEqual(["Backend Intern", "Remote Intern"]);
    expect(states()[0]!.post_state).toBe("pending");

    const later = fakePoster();
    await postPending(db, later, options(day1, { postInternational: true }));
    expect(later.calls.map((call) => call.message?.url)).toEqual(["https://job-boards.greenhouse.io/acme/jobs/1"]);
  });

  test("internships only for graduate students are held back", async () => {
    ingest(db, simplify, [
      greenhouse(1, { title: "Software Engineer Intern - MS/PhD" }),
      greenhouse(2, { title: "Research Intern", raw: JSON.stringify({ degrees: ["Master's", "PhD"] }) }),
      greenhouse(3, { title: "Data Science Intern", raw: JSON.stringify({ degrees: ["PhD"] }) }),
      greenhouse(4, { title: "Backend Intern", raw: JSON.stringify({ degrees: ["Bachelor's", "Master's"] }) }),
    ], { complete: false, now: day1 });
    // ECR says undergraduates can apply to job 3, so it is posted.
    ingest(db, ecr, [
      greenhouse(3, { sourceId: "job_3", title: "Data Science Intern", raw: JSON.stringify({ studentYears: ["3rd year"] }) }),
    ], { complete: false, now: day1 });

    const poster = fakePoster();
    const summary = await postPending(db, poster, options(day1));
    expect(summary).toMatchObject({ graduate: 2, eligible: 2, posted: 2 });
    expect(poster.calls.map((call) => call.message?.title)).toEqual(["Data Science Intern", "Backend Intern"]);
    expect(states().map((job) => job.post_state)).toEqual(["pending", "pending", "posted", "posted"]);
  });

  test("a job with a US location in any source is posted", async () => {
    ingest(db, simplify, [greenhouse(1, { locations: ["London, UK"] })], { complete: false, now: day1 });
    ingest(db, ecr, [greenhouse(1, { sourceId: "job_1", locations: ["Chicago, IL"] })], { complete: false, now: day1 });
    const summary = await postPending(db, fakePoster(), options(day1));
    expect(summary).toMatchObject({ international: 0, posted: 1 });
  });

  test("pending jobs expire after a week", async () => {
    ingest(db, simplify, [greenhouse(1, { active: false })], { complete: false, now: day1 });
    await postPending(db, fakePoster(), options(day1));
    ingest(db, simplify, [greenhouse(1)], { complete: false, now: new Date("2026-10-02T20:00:00Z") });
    const poster = fakePoster();
    await postPending(db, poster, options(new Date("2026-10-02T20:00:00Z")));
    expect(poster.calls).toHaveLength(0);
    expect(states()[0]!.post_state).toBe("expired");
  });

  test("a rolled-back dry run leaves no posting state behind", async () => {
    ingest(db, simplify, [greenhouse(1)], { complete: false, now: day1 });
    db.run("BEGIN");
    const summary = await postPending(db, fakePoster(), options(day1));
    db.run("ROLLBACK");
    expect(summary.posted).toBe(1);
    expect(states()[0]!.post_state).toBe("new");
  });
});
