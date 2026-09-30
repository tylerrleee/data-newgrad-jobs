import type { Database } from "bun:sqlite";
import { config } from "./config.ts";
import { etDay } from "./dates.ts";
import { getMeta, setAlerted, setMeta } from "./db.ts";
import { runFeeds } from "./feeds.ts";
import type { JobSource } from "./job.ts";
import type { Log } from "./log.ts";
import { postPending, type PostSummary } from "./post.ts";
import { describeSlackError, type SlackPoster } from "./slack.ts";

export interface RunOptions {
  channel: string;
  poster: SlackPoster;
  /** Fetch and ingest for real, but only print what would be posted. */
  dryRun: boolean;
  log: Log;
}

/** Logs what a real run would send instead of sending it. */
export function printingPoster(log: Log): SlackPoster {
  let count = 0;
  return {
    async post(message, threadTs) {
      const indent = threadTs ? "    ↳ " : "  + ";
      log.info(`${indent}${message.company} · ${message.title} · ${message.locations.join("; ") || "no location"}`);
      log.info(`${" ".repeat(indent.length)}${message.url}  [${message.sources.join(", ")}]`);
      return `dry-run.${++count}`;
    },
    async update(_ts, message) {
      log.info(`  ~ ${message.company} · ${message.title}: └ ${message.moreInThread} more in thread`);
    },
    async postText(text) {
      log.info(`  ! ${text}`);
    },
  };
}

function report(summary: PostSummary, dryRun: boolean, log: Log): void {
  const verb = dryRun ? "would post" : "posted";
  const held = [
    summary.international > 0 ? `${summary.international} international` : "",
    summary.graduate > 0 ? `${summary.graduate} graduate-only` : "",
    summary.highSchool > 0 ? `${summary.highSchool} high-school-only` : "",
  ].filter(Boolean);
  log.info(
    `posting: ${summary.decided} new jobs to consider, ${summary.expired} too old; ` +
      `${summary.eligible} eligible` +
      (held.length > 0 ? ` (${held.join(", ")} held back)` : "") +
      `, ${verb} ${summary.posted} + ${summary.replies} in threads, ` +
      `${summary.updated} parents updated, ${summary.deferred} left for the next run` +
      (summary.failed > 0 ? `, ${summary.failed} rejected by Slack` : "") +
      (summary.notUpdated > 0 ? `, ${summary.notUpdated} parents Slack wouldn't update` : ""),
  );
  if (summary.claimed.length > 0) {
    log.warn(
      `${summary.claimed.length} job(s) may or may not have reached Slack. Check the channel, then run ` +
        "`bun src/index.ts --requeue <id>...` for any that are missing and `--mark-posted <id> [ts]` for any that aren't:\n" +
        summary.claimed.map((job) => `  ${job.id}: ${job.title} at ${job.company} (${job.url})`).join("\n"),
    );
  }
  if (summary.stopped) log.error(`posting stopped: ${summary.stopped}`);
}

/** One pass: fetch the feeds that are due, then post what's new. Returns false if anything failed. */
export async function runOnce(db: Database, sources: JobSource[], options: RunOptions): Promise<boolean> {
  const { channel, poster, dryRun, log } = options;
  const now = new Date();
  const started = performance.now();
  log.info(dryRun ? "run started (dry run: nothing will be posted)" : "run started");

  const feeds = await runFeeds(db, sources, now, (line) => log.info(line));
  for (const alert of feeds.alerts) {
    try {
      await poster.postText(alert.text);
      if (!dryRun) setAlerted(db, alert.feed, alert.alerted);
    } catch (error) {
      log.error(`could not post alert "${alert.text}": ${describeSlackError(error)}`);
    }
  }

  const storedSince = getMeta(db, "post_since");
  const postSince = config.postSince ?? storedSince ?? etDay(now);
  if (!storedSince) {
    setMeta(db, "post_since", postSince);
    log.info(`first run: only jobs posted on or after ${postSince} will be posted`);
  }

  const postOptions = {
    channel,
    now,
    postSince,
    maxPosts: config.maxPostsPerRun,
    postInternational: config.postInternational,
  };
  let summary: PostSummary;
  if (dryRun) {
    // Everything about posting is rolled back; fetched listings stay, so a real run posts the same plan.
    db.run("BEGIN");
    try {
      summary = await postPending(db, poster, { ...postOptions, paceMs: 0 });
    } finally {
      db.run("ROLLBACK");
    }
  } else {
    summary = await postPending(db, poster, postOptions);
  }
  report(summary, dryRun, log);
  log.info(`run finished in ${((performance.now() - started) / 1000).toFixed(1)}s`);
  return !feeds.failed && !summary.stopped;
}
