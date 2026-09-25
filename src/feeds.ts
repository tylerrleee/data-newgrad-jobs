import type { Database } from "bun:sqlite";
import { feedState, recordAttempt, recordFailure, recordSuccess, storedRaw } from "./db.ts";
import { HttpError } from "./http.ts";
import { ingest } from "./ingest.ts";
import type { JobSource } from "./job.ts";

const DAY_MS = 86_400_000;
/** Post an alert to Slack when a feed fails this many times in a row, and again when it recovers. */
export const ALERT_AFTER = 3;

export interface FeedAlert {
  feed: string;
  text: string;
  /** Whether the feed counts as alerted once this alert reaches Slack. */
  alerted: boolean;
}

export interface FeedsResult {
  failed: boolean;
  /** Alerts are recorded as sent only once they reach Slack (see setAlerted), so none are lost. */
  alerts: FeedAlert[];
}

function backoffMs(source: JobSource, failures: number, error: unknown): number {
  if (error instanceof HttpError && [403, 404, 410].includes(error.status)) return DAY_MS;
  const exponential = source.minIntervalMinutes * 60_000 * 2 ** (failures - 1);
  const retryAfter = error instanceof HttpError ? (error.retryAfterSeconds ?? 0) * 1000 : 0;
  return Math.min(DAY_MS, Math.max(exponential, retryAfter));
}

function time(date: Date): string {
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Fetches every feed that is due and ingests what changed. One feed failing never affects another. */
export async function runFeeds(
  db: Database,
  sources: JobSource[],
  now: Date,
  log: (line: string) => void = console.log,
): Promise<FeedsResult> {
  const result: FeedsResult = { failed: false, alerts: [] };
  for (const source of sources) {
    const state = feedState(db, source.name);
    const due = new Date(
      Math.max(
        (state.lastAttemptAt?.getTime() ?? 0) + source.minIntervalMinutes * 60_000,
        state.nextAttemptAt?.getTime() ?? 0,
      ),
    );
    if (now < due) {
      log(`${source.name}: skipped until ${time(due)}`);
      continue;
    }
    // Committed before the request, so crashes and overlapping runs still respect the interval.
    recordAttempt(db, source.name, now);
    const started = performance.now();
    try {
      const fetched = await source.fetchListings({
        now,
        etag: state.etag,
        lastSuccessAt: state.lastSuccessAt,
        lastFullAt: state.lastFullAt,
        storedRaw: (sourceId) => storedRaw(db, source.name, sourceId),
      });
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      // The ETag is saved with the data it describes: if ingesting fails, the next run refetches.
      db.transaction(() => {
        if (!fetched.changed) {
          recordSuccess(db, source.name, now, fetched);
          log(`${source.name}: unchanged${fetched.detail ? `, ${fetched.detail}` : ""} (${seconds}s)`);
          return;
        }
        const stats = ingest(db, source, fetched.listings, { complete: fetched.complete, now });
        recordSuccess(db, source.name, now, fetched);
        const parts = [
          `${stats.listings} listings`,
          fetched.skipped > 0 ? `${fetched.skipped} unparseable rows skipped` : undefined,
          `${stats.newJobs} new jobs`,
          stats.reposts > 0 ? `${stats.reposts} reposts` : undefined,
          `${stats.deactivated} now inactive`,
          stats.guarded ? "too many missing at once, so only those gone 48h+ marked inactive" : undefined,
        ];
        const detail = fetched.detail ? ` ${fetched.detail}` : "";
        log(`${source.name}:${detail} ${parts.filter(Boolean).join(", ")} (${seconds}s)`);
      })();
      if (state.alerted) {
        result.alerts.push({ feed: source.name, text: `jobbo: ${source.name} is working again.`, alerted: false });
      }
    } catch (error) {
      const failures = state.failures + 1;
      const message = error instanceof Error ? error.message : String(error);
      const next = new Date(now.getTime() + backoffMs(source, failures, error));
      recordFailure(db, source.name, message, next);
      log(`${source.name}: FAILED (${message}); next try after ${time(next)}`);
      result.failed = true;
      if (failures >= ALERT_AFTER && !state.alerted) {
        const text = `jobbo: ${source.name} has failed ${failures} times in a row. Latest error: ${message}`;
        result.alerts.push({ feed: source.name, text, alerted: true });
      }
    }
  }
  return result;
}
