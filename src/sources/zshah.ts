import { canonicalKey, cleanUrl } from "../canonical.ts";
import { isDataRole, isEntryLevel } from "../classify.ts";
import { zshahPostedDay } from "../dates.ts";
import { get } from "../http.ts";
import type { JobSource, Listing } from "../job.ts";
import { cleanText } from "../text.ts";

export const ZSHAH_URL =
  "https://raw.githubusercontent.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/main/data/jobs.json";

const MAX_SKIPPED_SHARE = 0.05;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? cleanText(value) : "";
}

/** Undefined when the record has no id, usable url or date. */
export function zshahListing(record: unknown): Listing | undefined {
  if (!isRecord(record) || typeof record.id !== "string" || typeof record.url !== "string") return undefined;
  const url = cleanUrl(record.url);
  const postedDay = zshahPostedDay(record.posted_at, record.posted_at_source, record.first_seen_at);
  if (!url || !postedDay) return undefined;
  const title = text(record.title);
  const category = typeof record.category === "string" ? record.category : null;
  const location = text(record.location);
  return {
    sourceId: record.id,
    url,
    key: canonicalKey(url),
    company: text(record.company),
    title,
    locations: location ? [location] : [],
    category,
    postedDay,
    roleMatch: isDataRole({ category, title }),
    entryLevel: isEntryLevel(title, url),
    active: record.is_open === true,
    raw: JSON.stringify(record),
  };
}

/**
 * zshah101 polls about 4,900 employers' ATS boards itself and commits every job it has seen,
 * open or closed, to one JSON object keyed by job id, so each fetch is the whole state.
 */
export function zshahSource(url = ZSHAH_URL, { minRecords = 500 }: { minRecords?: number } = {}): JobSource {
  return {
    name: "zshah",
    source: "zshah",
    minIntervalMinutes: 20,
    async fetchListings(ctx) {
      const response = await get(url, { acceptEncoding: "gzip", etag: ctx.etag, timeoutMs: 60_000 });
      if (response.status === 304) return { changed: false };
      const data: unknown = JSON.parse(response.body);
      if (!isRecord(data)) throw new Error("jobs.json is not an object of jobs (format change?)");
      const records = Object.values(data);
      if (records.length < minRecords) {
        throw new Error(`jobs.json has ${records.length} jobs, expected at least ${minRecords}`);
      }
      const listings = records.map(zshahListing).filter((listing) => listing !== undefined);
      const skipped = records.length - listings.length;
      if (skipped > records.length * MAX_SKIPPED_SHARE) {
        throw new Error(`${skipped} of ${records.length} jobs have no usable id, url or date`);
      }
      return { changed: true, listings, complete: true, etag: response.etag, skipped };
    },
  };
}
