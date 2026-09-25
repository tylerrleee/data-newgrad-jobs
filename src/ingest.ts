import type { Database } from "bun:sqlite";
import { daysBetween } from "./dates.ts";
import { LOCATION_PRIORITY, SOURCE_PRIORITY, type Listing, type SourceName } from "./job.ts";
import { normalizeCompany, normalizeTitle } from "./text.ts";

/**
 * A new listing posted at least this many days after the latest listing of a job with no open
 * listings is a repost of that requisition, and so a new job.
 */
export const REPOST_DAYS = 30;
/** A complete snapshot missing more than this share of a feed's active listings is treated as partial. */
const MAX_DEACTIVATION = 0.3;
/** Listings missing this long are marked inactive even when a snapshot is treated as partial. */
const MAX_MISSING_MS = 48 * 3_600_000;

export interface IngestStats {
  listings: number;
  newJobs: number;
  reposts: number;
  deactivated: number;
  /** Too many listings were missing at once, so only long-missing ones were marked inactive. */
  guarded: boolean;
}

interface CurrentJob {
  id: number;
  last_posted_day: string;
  active: number;
  company_norm: string;
}

export function ingest(
  db: Database,
  feed: { name: string; source: SourceName },
  listings: Listing[],
  options: { complete: boolean; now: Date },
): IngestStats {
  const now = options.now.toISOString();
  const unique = new Map(listings.map((listing) => [listing.sourceId, listing]));
  const stats: IngestStats = { listings: unique.size, newJobs: 0, reposts: 0, deactivated: 0, guarded: false };
  const touched = new Set<number>();

  const existingJob = db.query<{ job_id: number }, { feed: string; sourceId: string }>(
    "SELECT job_id FROM listings WHERE feed = $feed AND source_id = $sourceId",
  );
  // Read from listings, not the jobs row, which is only refreshed at the end of the batch.
  const currentJob = db.query<CurrentJob, { key: string }>(
    `SELECT j.id, j.company_norm,
       (SELECT max(posted_day) FROM listings WHERE job_id = j.id) AS last_posted_day,
       (SELECT max(active) FROM listings WHERE job_id = j.id) AS active
     FROM listings l JOIN jobs j ON j.id = l.job_id
     WHERE l.key = $key ORDER BY j.id DESC LIMIT 1`,
  );
  const insertJob = db.query<{ id: number }, Record<string, string | number>>(
    `INSERT INTO jobs (company, title, url, company_norm, title_norm, locations, sources, posted_day,
                       last_posted_day, relevant, active, first_seen_at)
     VALUES ($company, $title, $url, $companyNorm, $titleNorm, $locations, $sources, $postedDay,
             $postedDay, $relevant, $active, $now)
     RETURNING id`,
  );
  const upsert = db.query(
    `INSERT INTO listings (feed, source, source_id, job_id, key, url, company, title, locations, category,
                           posted_day, software, internship, active, first_seen_at, last_seen_at, raw)
     VALUES ($feed, $source, $sourceId, $jobId, $key, $url, $company, $title, $locations, $category,
             $postedDay, $software, $internship, $active, $now, $now, $raw)
     ON CONFLICT (feed, source_id) DO UPDATE SET
       key = excluded.key, url = excluded.url, company = excluded.company, title = excluded.title,
       locations = excluded.locations, category = excluded.category,
       posted_day = min(posted_day, excluded.posted_day),
       software = excluded.software, internship = excluded.internship, active = excluded.active,
       last_seen_at = excluded.last_seen_at, raw = excluded.raw`,
  );

  const createJob = (listing: Listing): number => {
    stats.newJobs++;
    return insertJob.get({
      company: listing.company,
      title: listing.title,
      url: listing.url,
      companyNorm: normalizeCompany(listing.company),
      titleNorm: normalizeTitle(listing.title),
      locations: JSON.stringify(listing.locations),
      sources: JSON.stringify([feed.source]),
      postedDay: listing.postedDay,
      relevant: listing.software && listing.internship ? 1 : 0,
      active: listing.active ? 1 : 0,
      now,
    })!.id;
  };

  for (const listing of unique.values()) {
    let jobId = existingJob.get({ feed: feed.name, sourceId: listing.sourceId })?.job_id;
    if (jobId === undefined) {
      const current = currentJob.get({ key: listing.key });
      if (!current) {
        jobId = createJob(listing);
      } else if (current.active === 0 && daysBetween(current.last_posted_day, listing.postedDay) >= REPOST_DAYS) {
        stats.reposts++;
        jobId = createJob(listing);
      } else if (listing.key.startsWith("url:") && current.company_norm !== normalizeCompany(listing.company)) {
        // Generic keys are only trusted within one company.
        jobId = createJob(listing);
      } else {
        jobId = current.id;
      }
    }
    upsert.run({
      feed: feed.name,
      source: feed.source,
      sourceId: listing.sourceId,
      jobId,
      key: listing.key,
      url: listing.url,
      company: listing.company,
      title: listing.title,
      locations: JSON.stringify(listing.locations),
      category: listing.category,
      postedDay: listing.postedDay,
      software: listing.software ? 1 : 0,
      internship: listing.internship ? 1 : 0,
      active: listing.active ? 1 : 0,
      now,
      raw: listing.raw,
    });
    touched.add(jobId);
  }

  if (options.complete) {
    const missing = db
      .query<{ id: number; job_id: number; last_seen_at: string }, { feed: string; now: string }>(
        "SELECT id, job_id, last_seen_at FROM listings WHERE feed = $feed AND active = 1 AND last_seen_at < $now",
      )
      .all({ feed: feed.name, now });
    const active = db
      .query<{ n: number }, { feed: string }>("SELECT count(*) AS n FROM listings WHERE feed = $feed AND active = 1")
      .get({ feed: feed.name })!.n;
    // A sudden large drop looks like a broken snapshot, so only long-missing listings go inactive.
    // Those always do, so one real mass removal can't block deactivation forever.
    stats.guarded = missing.length > MAX_DEACTIVATION * active;
    const longGone = new Date(options.now.getTime() - MAX_MISSING_MS).toISOString();
    const deactivate = db.query("UPDATE listings SET active = 0 WHERE id = $id");
    for (const { id, job_id, last_seen_at } of missing) {
      if (stats.guarded && last_seen_at >= longGone) continue;
      deactivate.run({ id });
      touched.add(job_id);
      stats.deactivated++;
    }
  }

  for (const jobId of touched) refreshJob(db, jobId);
  return stats;
}

interface ListingRow {
  source: SourceName;
  url: string;
  company: string;
  title: string;
  locations: string;
  posted_day: string;
  software: number;
  internship: number;
  active: number;
  first_seen_at: string;
}

/** Recomputes a job's display fields and aggregates from all of its listings. */
export function refreshJob(db: Database, jobId: number): void {
  const rows = db
    .query<ListingRow, { jobId: number }>(
      `SELECT source, url, company, title, locations, posted_day, software, internship, active, first_seen_at
       FROM listings WHERE job_id = $jobId ORDER BY first_seen_at, id`,
    )
    .all({ jobId });
  if (rows.length === 0) {
    db.query("UPDATE jobs SET active = 0 WHERE id = $jobId").run({ jobId });
    return;
  }
  const rank = (priority: SourceName[]) => (a: ListingRow, b: ListingRow) =>
    b.active - a.active ||
    priority.indexOf(a.source) - priority.indexOf(b.source) ||
    a.first_seen_at.localeCompare(b.first_seen_at);
  const preferred = rows.toSorted(rank(SOURCE_PRIORITY))[0]!;
  // One source's list: each source spells the same places differently, so a union repeats them.
  // Every listing keeps its own locations.
  const located = rows.filter((row) => row.locations !== "[]").toSorted(rank(LOCATION_PRIORITY))[0];
  const days = rows.map((row) => row.posted_day).sort();
  db.query(
    `UPDATE jobs SET company = $company, title = $title, url = $url, company_norm = $companyNorm,
       title_norm = $titleNorm, locations = $locations, sources = $sources, posted_day = $postedDay,
       last_posted_day = $lastPostedDay, relevant = $relevant, active = $active
     WHERE id = $jobId`,
  ).run({
    jobId,
    company: preferred.company,
    title: preferred.title,
    url: preferred.url,
    companyNorm: normalizeCompany(preferred.company),
    titleNorm: normalizeTitle(preferred.title),
    locations: located?.locations ?? "[]",
    sources: JSON.stringify([...new Set(rows.map((row) => row.source))]),
    postedDay: days[0]!,
    lastPostedDay: days.at(-1)!,
    relevant: rows.some((row) => row.software) && rows.every((row) => row.internship) ? 1 : 0,
    active: rows.some((row) => row.active) ? 1 : 0,
  });
}
