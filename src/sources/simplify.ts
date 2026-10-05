import { canonicalKey, cleanUrl } from "../canonical.ts";
import { isDataRole, isEntryLevel } from "../classify.ts";
import { simplifyPostedDay } from "../dates.ts";
import { get, RangeIgnoredError } from "../http.ts";
import type { FetchContext, FetchResult, JobSource, Listing } from "../job.ts";
import { cleanText } from "../text.ts";

export const SIMPLIFY_URL =
  "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const TAIL_BYTES = 262_144;
const MAX_SKIPPED_SHARE = 0.05;
/** listings.json is written with indent=4, so each top-level record opens on a line of exactly "    {". */
const RECORD_START = /\n    \{\n/;
const PLACE_NAMES = new Map([
  ["SF", "San Francisco, CA"],
  ["NYC", "New York, NY"],
  ["LA", "Los Angeles, CA"],
]);

/** Parses the whole records in a byte suffix of listings.json; the first piece is cut off, so it is dropped. */
export function parseSimplifyTail(body: string): unknown[] {
  const pieces = body.split(RECORD_START).slice(1);
  if (pieces.length === 0) throw new Error("no indent=4 records in the tail (format change?)");
  return pieces.map((piece, index) => {
    const text = piece.trimEnd().replace(/(,|\n\])$/, "");
    try {
      return JSON.parse(`{\n${text}`);
    } catch (error) {
      throw new Error(`tail record ${index + 1} of ${pieces.length} does not parse (format change?)`, {
        cause: error,
      });
    }
  });
}

function text(value: unknown): string {
  return typeof value === "string" ? cleanText(value) : "";
}

function place(value: unknown): string {
  const name = text(value);
  return PLACE_NAMES.get(name) ?? name;
}

/** Undefined when the record has no usable id, url or date_posted. */
export function simplifyListing(record: unknown): Listing | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const fields = record as Record<string, unknown>;
  const url = typeof fields.url === "string" ? cleanUrl(fields.url) : undefined;
  const postedDay = simplifyPostedDay(fields.date_posted);
  if (typeof fields.id !== "string" || fields.id === "" || url === undefined || postedDay === undefined) {
    return undefined;
  }
  const title = text(fields.title);
  const category = typeof fields.category === "string" ? fields.category : null;
  return {
    sourceId: fields.id,
    url,
    key: canonicalKey(url),
    company: text(fields.company_name),
    title,
    locations: Array.isArray(fields.locations) ? fields.locations.map(place).filter(Boolean) : [],
    category,
    postedDay,
    roleMatch: isDataRole({ category, title }),
    entryLevel: isEntryLevel(title, url),
    active: fields.active === true && fields.is_visible === true,
    raw: JSON.stringify(record),
  };
}

/** One listing per id (the last record wins); throws when too many records are unusable. */
function toListings(records: unknown[]): { listings: Listing[]; skipped: number } {
  const listings = new Map<string, Listing>();
  let skipped = 0;
  for (const record of records) {
    const listing = simplifyListing(record);
    if (listing) listings.set(listing.sourceId, listing);
    else skipped += 1;
  }
  if (skipped > records.length * MAX_SKIPPED_SHARE) {
    throw new Error(`${skipped} of ${records.length} records have no usable id, url or date_posted`);
  }
  return { listings: [...listings.values()], skipped };
}

function needsFull(ctx: FetchContext): boolean {
  if (!ctx.lastSuccessAt || !ctx.lastFullAt) return true;
  const now = ctx.now.getTime();
  return now - ctx.lastFullAt.getTime() >= DAY_MS || now - ctx.lastSuccessAt.getTime() > DAY_MS;
}

/**
 * Hourly runs fetch only the last 256 KB (~350 records, ~2 days). Simplify appends new records and
 * re-appends edited ones, so the tail covers everything since our last fetch whenever it holds a
 * record we stored with exactly the same content. Otherwise, and once a day, the whole file is fetched.
 */
export function simplifySource(
  url = SIMPLIFY_URL,
  { minTailRecords = 100, minFullRecords = 5000 }: { minTailRecords?: number; minFullRecords?: number } = {},
): JobSource {
  // No If-None-Match: the gzip ETag differs from the identity one kept for tail requests.
  async function fetchFull(detail: string): Promise<FetchResult> {
    const response = await get(url, { acceptEncoding: "gzip", timeoutMs: 60_000 });
    if (response.status === 304) throw new Error("unexpected 304 without If-None-Match");
    const records: unknown = JSON.parse(response.body);
    if (!Array.isArray(records) || records.length < minFullRecords) {
      const count = Array.isArray(records) ? records.length : "no";
      throw new Error(`full file has ${count} records, expected at least ${minFullRecords}`);
    }
    return { changed: true, ...toListings(records), complete: true, full: true, detail };
  }

  // The whole file is fetched at most every 6 hours; until then an unusable tail just waits.
  async function fallBack(ctx: FetchContext, reason: string): Promise<FetchResult> {
    if (ctx.lastFullAt && ctx.now.getTime() - ctx.lastFullAt.getTime() < 6 * HOUR_MS) {
      return { changed: false, detail: `tail unusable (${reason}), waiting for the next full fetch` };
    }
    return fetchFull(`full (${reason})`);
  }

  async function fetchTail(ctx: FetchContext): Promise<FetchResult> {
    let response;
    try {
      response = await get(url, {
        acceptEncoding: "identity",
        range: `bytes=-${TAIL_BYTES}`,
        etag: ctx.etag,
        timeoutMs: 30_000,
        decompress: false,
      });
    } catch (error) {
      if (error instanceof RangeIgnoredError) return fallBack(ctx, "range ignored");
      throw error;
    }
    if (response.status === 304) return { changed: false };
    let records: unknown[];
    try {
      records = parseSimplifyTail(response.body);
    } catch (error) {
      return fallBack(ctx, error instanceof Error ? error.message : String(error));
    }
    if (records.length < minTailRecords) {
      return fallBack(ctx, `only ${records.length} records, expected at least ${minTailRecords}`);
    }
    const { listings, skipped } = toListings(records);
    if (!listings.some((listing) => ctx.storedRaw(listing.sourceId) === listing.raw)) {
      return fallBack(ctx, "tail gap");
    }
    return { changed: true, listings, complete: false, etag: response.etag, skipped, detail: "tail" };
  }

  return {
    name: "simplify-newgrad",
    source: "simplify",
    minIntervalMinutes: 20,
    fetchListings: (ctx) => (needsFull(ctx) ? fetchFull("full") : fetchTail(ctx)),
  };
}
