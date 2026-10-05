import { Database } from "bun:sqlite";
import { CANONICAL_VERSION, canonicalKey } from "./canonical.ts";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;

  CREATE TABLE IF NOT EXISTS feeds (
    name TEXT PRIMARY KEY,
    etag TEXT,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_full_at TEXT,
    next_attempt_at TEXT,
    failures INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    -- A failure alert reached Slack and a recovery alert hasn't yet.
    alerted INTEGER NOT NULL DEFAULT 0
  ) STRICT;

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    company_norm TEXT NOT NULL,
    title_norm TEXT NOT NULL,
    locations TEXT NOT NULL,
    sources TEXT NOT NULL,
    posted_day TEXT NOT NULL,
    last_posted_day TEXT NOT NULL,
    relevant INTEGER NOT NULL,
    active INTEGER NOT NULL,
    first_seen_at TEXT NOT NULL,
    post_state TEXT NOT NULL DEFAULT 'new'
      CHECK (post_state IN ('new', 'expired', 'pending', 'claimed', 'posted', 'failed')),
    decided_at TEXT,
    claimed_at TEXT,
    post_error TEXT,
    slack_channel TEXT,
    slack_ts TEXT,
    thread_ts TEXT,
    shown_replies INTEGER NOT NULL DEFAULT 0,
    posted_at TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS jobs_by_state ON jobs (post_state);
  CREATE INDEX IF NOT EXISTS jobs_by_name ON jobs (company_norm, title_norm);

  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY,
    feed TEXT NOT NULL,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    job_id INTEGER NOT NULL REFERENCES jobs (id),
    key TEXT NOT NULL,
    url TEXT NOT NULL,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    locations TEXT NOT NULL,
    category TEXT,
    posted_day TEXT NOT NULL,
    role_match INTEGER NOT NULL,
    entry_level INTEGER NOT NULL,
    active INTEGER NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    raw TEXT NOT NULL,
    UNIQUE (feed, source_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS listings_by_key ON listings (key);
  CREATE INDEX IF NOT EXISTS listings_by_job ON listings (job_id);

  -- The posting text of jobs that may be posted, read once (description.ts).
  CREATE TABLE IF NOT EXISTS descriptions (
    job_id INTEGER PRIMARY KEY REFERENCES jobs (id),
    status TEXT NOT NULL CHECK (status IN ('ok', 'unavailable')),
    text TEXT,
    fetched_at TEXT NOT NULL
  ) STRICT;

  -- Every scraped listing and whether its job has been posted.
  CREATE VIEW IF NOT EXISTS listing_status AS
    SELECT l.feed, l.source_id, l.company, l.title, l.locations, l.posted_day, l.active,
           j.id AS job_id, j.post_state, j.slack_ts
    FROM listings l JOIN jobs j ON j.id = l.job_id;
`;

export function openDb(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");
  db.run(SCHEMA);
  migrateToNewGrad(db);
  db.run("PRAGMA user_version = 2");
  rekeyIfCanonicalChanged(db);
  return db;
}

/**
 * Version 1 tracked software internships in `software` and `internship`. Those listings come from
 * the internship feeds, which are no longer read, so they match nothing now and their unposted
 * jobs are never posted.
 */
function migrateToNewGrad(db: Database): void {
  const columns = db.query<{ name: string }, []>("SELECT name FROM pragma_table_info('listings')").all();
  if (!columns.some((column) => column.name === "software")) return;
  db.transaction(() => {
    db.run("ALTER TABLE listings RENAME COLUMN software TO role_match");
    db.run("ALTER TABLE listings RENAME COLUMN internship TO entry_level");
    db.run("UPDATE listings SET role_match = 0, entry_level = 0");
    db.run("UPDATE jobs SET relevant = 0 WHERE post_state IN ('new', 'pending')");
  })();
}

export function getMeta(db: Database, key: string): string | undefined {
  return db.query<{ value: string }, { key: string }>("SELECT value FROM meta WHERE key = $key").get({ key })
    ?.value;
}

export function setMeta(db: Database, key: string, value: string): void {
  db.query("INSERT INTO meta (key, value) VALUES ($key, $value) ON CONFLICT (key) DO UPDATE SET value = $value").run({
    key,
    value,
  });
}

/** Recomputes stored keys after canonicalKey changes, so a rule tweak never splits a job. */
export function rekeyIfCanonicalChanged(db: Database): number {
  if (getMeta(db, "canonical_version") === String(CANONICAL_VERSION)) return 0;
  let changed = 0;
  db.transaction(() => {
    const update = db.query("UPDATE listings SET key = $key WHERE id = $id");
    for (const { id, url, key } of db.query<{ id: number; url: string; key: string }, []>(
      "SELECT id, url, key FROM listings",
    ).all()) {
      const next = canonicalKey(url);
      if (next !== key) {
        update.run({ id, key: next });
        changed++;
      }
    }
    setMeta(db, "canonical_version", String(CANONICAL_VERSION));
  })();
  return changed;
}

export interface FeedState {
  etag?: string;
  lastAttemptAt?: Date;
  lastSuccessAt?: Date;
  lastFullAt?: Date;
  nextAttemptAt?: Date;
  failures: number;
  lastError?: string;
  alerted: boolean;
}

interface FeedRow {
  etag: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_full_at: string | null;
  next_attempt_at: string | null;
  failures: number;
  last_error: string | null;
  alerted: number;
}

function date(value: string | null): Date | undefined {
  return value === null ? undefined : new Date(value);
}

export function feedState(db: Database, name: string): FeedState {
  const row = db.query<FeedRow, { name: string }>("SELECT * FROM feeds WHERE name = $name").get({ name });
  if (!row) return { failures: 0, alerted: false };
  return {
    etag: row.etag ?? undefined,
    lastAttemptAt: date(row.last_attempt_at),
    lastSuccessAt: date(row.last_success_at),
    lastFullAt: date(row.last_full_at),
    nextAttemptAt: date(row.next_attempt_at),
    failures: row.failures,
    lastError: row.last_error ?? undefined,
    alerted: row.alerted === 1,
  };
}

export function recordAttempt(db: Database, name: string, now: Date): void {
  db.query(
    `INSERT INTO feeds (name, last_attempt_at) VALUES ($name, $now)
     ON CONFLICT (name) DO UPDATE SET last_attempt_at = $now`,
  ).run({ name, now: now.toISOString() });
}

export function recordSuccess(
  db: Database,
  name: string,
  now: Date,
  result: { etag?: string; full?: boolean; nextAttemptAt?: Date },
): void {
  db.query(
    `UPDATE feeds SET
       etag = coalesce($etag, etag),
       last_success_at = $now,
       last_full_at = CASE WHEN $full THEN $now ELSE last_full_at END,
       next_attempt_at = $next,
       failures = 0,
       last_error = NULL
     WHERE name = $name`,
  ).run({
    name,
    now: now.toISOString(),
    etag: result.etag ?? null,
    full: result.full ? 1 : 0,
    next: result.nextAttemptAt?.toISOString() ?? null,
  });
}

export function recordFailure(db: Database, name: string, error: string, nextAttemptAt: Date): void {
  db.query(
    `UPDATE feeds SET failures = failures + 1, last_error = $error, next_attempt_at = $next WHERE name = $name`,
  ).run({ name, error, next: nextAttemptAt.toISOString() });
}

export function setAlerted(db: Database, name: string, alerted: boolean): void {
  db.query("UPDATE feeds SET alerted = $alerted WHERE name = $name").run({ name, alerted: alerted ? 1 : 0 });
}

export function saveDescription(
  db: Database,
  jobId: number,
  description: { status: "ok"; text: string } | { status: "unavailable" },
  now: Date,
): void {
  db.query(
    `INSERT INTO descriptions (job_id, status, text, fetched_at) VALUES ($jobId, $status, $text, $now)
     ON CONFLICT (job_id) DO UPDATE SET status = $status, text = $text, fetched_at = $now`,
  ).run({
    jobId,
    status: description.status,
    text: description.status === "ok" ? description.text : null,
    now: now.toISOString(),
  });
}

export function storedRaw(db: Database, feed: string, sourceId: string): string | undefined {
  return db
    .query<{ raw: string }, { feed: string; sourceId: string }>(
      "SELECT raw FROM listings WHERE feed = $feed AND source_id = $sourceId",
    )
    .get({ feed, sourceId })?.raw;
}
