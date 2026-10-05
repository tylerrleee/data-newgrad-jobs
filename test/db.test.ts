import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jobbo-db-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("an internship database is renamed and its unposted jobs are never posted", () => {
  const path = join(dir, "jobbo.sqlite");
  // Today's schema with version 1's column names.
  openDb(path).close();
  const old = new Database(path, { strict: true });
  old.run("ALTER TABLE listings RENAME COLUMN role_match TO software");
  old.run("ALTER TABLE listings RENAME COLUMN entry_level TO internship");
  for (const [id, state] of [[1, "pending"], [2, "new"], [3, "posted"]] as const) {
    old.run(
      `INSERT INTO jobs (id, company, title, url, company_norm, title_norm, locations, sources, posted_day,
                         last_posted_day, relevant, active, first_seen_at, post_state)
       VALUES (?, 'Acme', 'Intern', 'https://x', 'acme', 'intern', '[]', '[]', '2026-09-24', '2026-09-24', 1, 1, '', ?)`,
      [id, state],
    );
  }
  old.run(
    `INSERT INTO listings (feed, source, source_id, job_id, key, url, company, title, locations, posted_day,
                           software, internship, active, first_seen_at, last_seen_at, raw)
     VALUES ('simplify', 'simplify', 'a', 1, 'k', 'https://x', 'Acme', 'Intern', '[]', '2026-09-24', 1, 1, 1, '', '', '{}')`,
  );
  old.close();

  const db = openDb(path);
  expect(db.query("SELECT role_match, entry_level FROM listings").all()).toEqual([{ role_match: 0, entry_level: 0 }]);
  expect(db.query("SELECT id, relevant FROM jobs ORDER BY id").all()).toEqual([
    { id: 1, relevant: 0 },
    { id: 2, relevant: 0 },
    { id: 3, relevant: 1 },
  ]);
  db.close();
  // Opening again finds nothing left to migrate.
  openDb(path).close();
});
