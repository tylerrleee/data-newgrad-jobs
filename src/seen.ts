import { Database } from "bun:sqlite";

/** Jobs that have already been posted, with the Slack message each became. */
export class SeenJobs {
  #db: Database;

  constructor(path: string) {
    this.#db = new Database(path, { create: true, strict: true });
    this.#db.run(`
      CREATE TABLE IF NOT EXISTS seen_jobs (
        key TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        ts TEXT NOT NULL,
        posted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  has(key: string): boolean {
    return this.#db.query("SELECT 1 FROM seen_jobs WHERE key = $key").get({ key }) !== null;
  }

  add(key: string, channel: string, ts: string): void {
    this.#db
      .query("INSERT INTO seen_jobs (key, channel, ts) VALUES ($key, $channel, $ts)")
      .run({ key, channel, ts });
  }
}
