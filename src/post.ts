import type { Database } from "bun:sqlite";
import { addDays, etDay } from "./dates.ts";
import { isGraduateOnly, isHighSchoolOnly } from "./degree.ts";
import { SOURCE_LABELS, type SourceName } from "./job.ts";
import { isInternational } from "./region.ts";
import { classifySlackError, describeSlackError, type JobMessage, type SlackPoster } from "./slack.ts";

/** A job is only posted if it was posted at most this many days ago when jobbo first saw it. */
export const MAX_AGE_DAYS = 7;
/** Openings with the same company and title posted this close together share a thread. */
export const LOOKALIKE_DAYS = 3;
/** chat.postMessage allows about one message per second per channel. */
const PACE_MS = 1100;
/** Slack rejecting this many messages in a row points at a problem with every message, not one. */
const MAX_REJECTED_IN_A_ROW = 3;

export interface PostOptions {
  channel: string;
  now: Date;
  /** Never post jobs posted before this day (YYYY-MM-DD). */
  postSince: string;
  maxPosts: number;
  /** Also post jobs whose only locations are outside the US. */
  postInternational?: boolean;
  paceMs?: number;
}

export interface JobRow {
  id: number;
  company: string;
  title: string;
  url: string;
  company_norm: string;
  title_norm: string;
  locations: string;
  sources: string;
  posted_day: string;
  slack_ts: string | null;
  claimed_at: string | null;
}

export interface PostSummary {
  expired: number;
  decided: number;
  eligible: number;
  /** Jobs held back because they are only outside the US; they stay pending until they expire. */
  international: number;
  /** Jobs held back because only graduate students can apply; they also stay pending until they expire. */
  graduate: number;
  /** Jobs held back because only high school students can apply; they also stay pending until they expire. */
  highSchool: number;
  posted: number;
  replies: number;
  updated: number;
  /** Parents whose "└ N more" line Slack wouldn't update (deleted, or too old to edit). */
  notUpdated: number;
  deferred: number;
  failed: number;
  /** Jobs whose post may or may not have reached Slack; they need a person to look. */
  claimed: JobRow[];
  stopped?: string;
}

function message(job: JobRow, moreInThread: number): JobMessage {
  return {
    title: job.title,
    company: job.company,
    url: job.url,
    locations: JSON.parse(job.locations) as string[],
    sources: (JSON.parse(job.sources) as SourceName[]).map((source) => SOURCE_LABELS[source]),
    moreInThread,
  };
}

export async function postPending(db: Database, poster: SlackPoster, options: PostOptions): Promise<PostSummary> {
  const now = options.now.toISOString();
  const today = etDay(options.now);
  const minimum = addDays(today, -MAX_AGE_DAYS);
  const since = options.postSince > minimum ? options.postSince : minimum;
  const summary: PostSummary = {
    expired: 0,
    decided: 0,
    eligible: 0,
    international: 0,
    graduate: 0,
    highSchool: 0,
    posted: 0,
    replies: 0,
    updated: 0,
    notUpdated: 0,
    deferred: 0,
    failed: 0,
    claimed: [],
  };

  // Each job's freshness is decided once, so later date changes can't revive old jobs or drop new ones.
  summary.expired += db
    .query(
      `UPDATE jobs SET post_state = 'expired', decided_at = $now WHERE post_state = 'new' AND posted_day < $since`,
    )
    .run({ now, since }).changes;
  summary.decided = db
    .query(`UPDATE jobs SET post_state = 'pending', decided_at = $now WHERE post_state = 'new'`)
    .run({ now }).changes;
  summary.expired += db
    .query(`UPDATE jobs SET post_state = 'expired' WHERE post_state = 'pending' AND decided_at < $stale`)
    .run({ stale: new Date(options.now.getTime() - MAX_AGE_DAYS * 86_400_000).toISOString() }).changes;

  summary.claimed = db.query<JobRow, []>("SELECT * FROM jobs WHERE post_state = 'claimed' ORDER BY id").all();

  const pending = db
    .query<JobRow, []>(
      `SELECT * FROM jobs WHERE post_state = 'pending' AND relevant = 1 AND active = 1
       ORDER BY posted_day, first_seen_at, id`,
    )
    .all();
  // Every listing counts, not only the one shown: any US location keeps the job, and so does any
  // sign that undergraduates can apply.
  const listingsOf = db.query<
    { feed: string; source: SourceName; title: string; locations: string; raw: string },
    { id: number }
  >("SELECT feed, source, title, locations, raw FROM listings WHERE job_id = $id");
  const candidates: JobRow[] = [];
  for (const job of pending) {
    const listings = listingsOf.all({ id: job.id });
    const locations = listings.map((row) => ({
      feed: row.feed,
      title: row.title,
      locations: JSON.parse(row.locations) as string[],
    }));
    if (!options.postInternational && isInternational(locations)) summary.international++;
    else if (isGraduateOnly(listings)) summary.graduate++;
    else if (isHighSchoolOnly(listings)) summary.highSchool++;
    else candidates.push(job);
  }
  summary.eligible = candidates.length;

  const findParent = db.query<{ slack_ts: string }, Record<string, string | number>>(
    `SELECT slack_ts FROM jobs
     WHERE post_state = 'posted' AND slack_channel = $channel AND thread_ts IS NULL AND id != $id
       AND company_norm = $company AND title_norm = $title
       AND abs(julianday(posted_day) - julianday($day)) <= $days
     ORDER BY posted_day DESC, id DESC LIMIT 1`,
  );
  const claim = db.query(
    `UPDATE jobs SET post_state = 'claimed', claimed_at = $now WHERE id = $id AND post_state = 'pending'`,
  );
  const recordPost = db.query(
    `UPDATE jobs SET post_state = 'posted', slack_channel = $channel, slack_ts = $ts, thread_ts = $threadTs,
       posted_at = $now, post_error = NULL
     WHERE id = $id`,
  );
  const release = db.query(`UPDATE jobs SET post_state = 'pending', claimed_at = NULL, post_error = $error WHERE id = $id`);
  const markFailed = db.query(`UPDATE jobs SET post_state = $state, post_error = $error WHERE id = $id`);

  const pace = () => Bun.sleep(options.paceMs ?? PACE_MS);
  let sent = 0;
  let rejectedInARow = 0;
  for (const [index, job] of candidates.entries()) {
    if (sent >= options.maxPosts) {
      summary.deferred = candidates.length - index;
      break;
    }
    const parent =
      job.company_norm && job.title_norm
        ? findParent.get({
            channel: options.channel,
            id: job.id,
            company: job.company_norm,
            title: job.title_norm,
            day: job.posted_day,
            days: LOOKALIKE_DAYS,
          })
        : null;
    if (claim.run({ id: job.id, now }).changes !== 1) continue;
    sent++;
    try {
      let threadTs = parent?.slack_ts;
      let ts: string;
      try {
        ts = await poster.post(message(job, 0), threadTs);
      } catch (error) {
        // A thread that won't take replies mustn't hide the opening: post it on its own instead.
        if (!threadTs || classifySlackError(error) !== "failed") throw error;
        await pace();
        threadTs = undefined;
        ts = await poster.post(message(job, 0));
      }
      recordPost.run({ id: job.id, channel: options.channel, ts, threadTs: threadTs ?? null, now });
      if (threadTs) summary.replies++;
      else summary.posted++;
      rejectedInARow = 0;
    } catch (error) {
      const reason = describeSlackError(error);
      const failure = classifySlackError(error);
      if (failure === "failed") {
        markFailed.run({ id: job.id, state: "failed", error: reason });
        summary.failed++;
        if (++rejectedInARow >= MAX_REJECTED_IN_A_ROW) {
          summary.stopped = `Slack rejected ${rejectedInARow} messages in a row, latest: ${reason}`;
          summary.deferred = candidates.length - index - 1;
          break;
        }
      } else {
        if (failure === "retry") release.run({ id: job.id, error: reason });
        else markFailed.run({ id: job.id, state: "claimed", error: reason });
        summary.stopped = `${job.title} (${job.url}): ${reason}`;
        summary.deferred = candidates.length - index - 1;
        break;
      }
    }
    await pace();
  }

  if (!summary.stopped) await updateParents(db, poster, options, summary);
  return summary;
}

/** Keeps each parent's "└ N more openings in thread" line in step with its posted replies. */
async function updateParents(db: Database, poster: SlackPoster, options: PostOptions, summary: PostSummary) {
  const parents = db
    .query<JobRow & { replies: number }, { channel: string }>(
      `SELECT p.*, count(r.id) AS replies
       FROM jobs p JOIN jobs r ON r.thread_ts = p.slack_ts AND r.slack_channel = p.slack_channel
       WHERE p.post_state = 'posted' AND p.thread_ts IS NULL AND p.slack_channel = $channel
         AND r.post_state = 'posted'
       GROUP BY p.id HAVING count(r.id) != p.shown_replies`,
    )
    .all({ channel: options.channel });
  const setShown = db.query("UPDATE jobs SET shown_replies = $replies WHERE id = $id");
  for (const parent of parents) {
    try {
      await poster.update(parent.slack_ts!, message(parent, parent.replies));
      summary.updated++;
    } catch (error) {
      // Only a rejection of this one message (deleted, too old to edit) is final; anything else is retried next run.
      if (classifySlackError(error) !== "failed") {
        summary.stopped = `updating ${parent.title} (${parent.slack_ts}): ${describeSlackError(error)}`;
        return;
      }
      summary.notUpdated++;
    }
    setShown.run({ id: parent.id, replies: parent.replies });
    await Bun.sleep(options.paceMs ?? PACE_MS);
  }
}

/** Puts claimed jobs back in the queue after someone has checked they never reached Slack. */
export function requeue(db: Database, ids: number[], now: Date): JobRow[] {
  // A fresh decision time, so a job requeued days later isn't expired before it is posted.
  const update = db.query<JobRow, { id: number; now: string }>(
    `UPDATE jobs SET post_state = 'pending', claimed_at = NULL, decided_at = $now
     WHERE id = $id AND post_state = 'claimed' RETURNING *`,
  );
  return ids.flatMap((id) => update.get({ id, now: now.toISOString() }) ?? []);
}

/**
 * Records that a claimed job did reach Slack. With the message's ts, later look-alike openings go
 * into its thread.
 */
export function markPosted(db: Database, id: number, channel: string, ts?: string): JobRow | undefined {
  return (
    db
      .query<JobRow, Record<string, string | number | null>>(
        `UPDATE jobs SET post_state = 'posted', slack_channel = $channel, slack_ts = $ts, posted_at = claimed_at
         WHERE id = $id AND post_state = 'claimed' RETURNING *`,
      )
      .get({ id, channel, ts: ts ?? null }) ?? undefined
  );
}
