import { canonicalKey, cleanUrl } from "../canonical.ts";
import { isDataRole, isEntryLevel } from "../classify.ts";
import { speedyapplyPostedDay } from "../dates.ts";
import { get } from "../http.ts";
import type { JobSource, Listing } from "../job.ts";
import { cleanText } from "../text.ts";

type Category = "swe" | "ai";

const TABLES = ["TABLE_FAANG", "TABLE_QUANT", "TABLE"];
const HEADERS = new Map([
  ["| Company | Position | Location | Posting | Age |", 5],
  ["| Company | Position | Location | Salary | Posting | Age |", 6],
]);
const SEPARATOR = /^\|(\s*:?-+:?\s*\|)+$/;
const MAX_SKIPPED_SHARE = 0.05;

function marker(lines: string[], text: string, from: number): number {
  const at = lines.findIndex((line, index) => index >= from && line.trim() === text);
  if (at < 0) throw new Error(`missing ${text}`);
  return at;
}

function tableRows(lines: string[], table: string): { columns: number; rows: string[] } {
  const start = marker(lines, `<!-- ${table}_START -->`, 0);
  const end = marker(lines, `<!-- ${table}_END -->`, start + 1);
  const body = lines.slice(start + 1, end).filter((line) => line.trim() !== "");
  const header = body[0] ?? "";
  const columns = HEADERS.get(header);
  if (columns === undefined) throw new Error(`unexpected ${table} header: ${header}`);
  return { columns, rows: body.slice(1).filter((line) => !SEPARATOR.test(line.trim())) };
}

/** Cells are read from the end so that a "|" inside the title stays in the title. */
function parseRow(row: string, columns: number, fetchedAt: Date, category: Category): Listing | undefined {
  const line = row.trim();
  if (!line.startsWith("|")) return undefined;
  const cells = line.slice(1).replace(/\|$/, "").split("|");
  if (cells.length < columns) return undefined;
  const age = cells.at(-1)!;
  const posting = cells.at(-2)!;
  const locationAt = cells.length - (columns - 2);
  const href = /href="(https?:\/\/[^"]+)"/i.exec(posting)?.[1];
  const url = href === undefined ? undefined : cleanUrl(href);
  const postedDay = speedyapplyPostedDay(fetchedAt, cleanText(age));
  if (url === undefined || postedDay === undefined) return undefined;
  const title = cleanText(cells.slice(1, locationAt).join("|"));
  const location = cleanText(cells[locationAt]!);
  return {
    sourceId: url,
    url,
    key: canonicalKey(url),
    company: cleanText(cells[0]!.replace(/<[^>]*>/g, "")),
    title,
    locations: location ? [location] : [],
    category,
    postedDay,
    roleMatch: isDataRole({ category, title }),
    entryLevel: isEntryLevel(title, url),
    active: true,
    raw: row,
  };
}

/** Parses the three tables of a speedyapply README; throws if the format changed. */
export function parseSpeedyapply(
  markdown: string,
  fetchedAt: Date,
  category: Category,
): { listings: Listing[]; skipped: number; rows: number } {
  const lines = markdown.split(/\r?\n/);
  const tables = TABLES.map((table) => tableRows(lines, table));
  const listings = new Map<string, Listing>();
  let rows = 0;
  let skipped = 0;
  for (const { columns, rows: tableLines } of tables) {
    for (const row of tableLines) {
      rows += 1;
      const listing = parseRow(row, columns, fetchedAt, category);
      if (listing) listings.set(listing.sourceId, listing);
      else skipped += 1;
    }
  }
  return { listings: [...listings.values()], skipped, rows };
}

/**
 * speedyapply regenerates its files once a day between 12:48Z and 22:06Z, so after a new version
 * the next one can't appear before the next 12:00Z.
 */
/**
 * speedyapply's bot regenerates the files once a day, between about 12:48 and 22:06 UTC. Outside
 * that window nothing changes, so the next check waits until noon UTC.
 */
function nextCheck(now: Date): Date | undefined {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= 12 * 60 && minutes < 22 * 60 + 30 ? undefined : nextNoonUtc(now);
}

function nextNoonUtc(now: Date): Date {
  const noon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  return noon > now ? noon : new Date(noon.getTime() + 86_400_000);
}

export function speedyapplySource(name: string, url: string, category: Category): JobSource {
  return {
    name,
    source: "speedyapply",
    minIntervalMinutes: 20,
    async fetchListings(ctx) {
      const response = await get(url, { acceptEncoding: "gzip", etag: ctx.etag, timeoutMs: 30_000 });
      if (response.status === 304) return { changed: false, nextAttemptAt: nextCheck(ctx.now) };
      const { listings, skipped, rows } = parseSpeedyapply(response.body, ctx.now, category);
      if (skipped > rows * MAX_SKIPPED_SHARE) {
        throw new Error(`${skipped} of ${rows} rows have no usable URL or age`);
      }
      return {
        changed: true,
        listings,
        complete: true,
        etag: response.etag,
        skipped,
        nextAttemptAt: nextCheck(ctx.now),
      };
    },
  };
}

const BASE = "https://raw.githubusercontent.com/speedyapply";

export function speedyapplySources(): JobSource[] {
  return [
    speedyapplySource("speedyapply-ai-newgrad-us", `${BASE}/2027-AI-College-Jobs/main/NEW_GRAD_USA.md`, "ai"),
    // Data titles turn up in the SWE list too; isDataRole picks them out.
    speedyapplySource("speedyapply-swe-newgrad-us", `${BASE}/2027-SWE-College-Jobs/main/NEW_GRAD_USA.md`, "swe"),
  ];
}
