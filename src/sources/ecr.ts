import { canonicalKey, cleanUrl } from "../canonical.ts";
import { isInternship, isSoftware } from "../classify.ts";
import { ecrPostedDay } from "../dates.ts";
import { get } from "../http.ts";
import type { FetchResult, JobSource, Listing } from "../job.ts";
import { cleanText } from "../text.ts";

export const ECR_URL = "https://earlycareerradar.com/summer-internships";

const JOBS = '"initialJobs":[';
const DATA_STATE = /"initialDataState":"(\w+)"/;
const MAX_SKIPPED = 0.05;

/** The index just past the JSON array or object that opens at `start`, skipping over strings. */
function closingBracket(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "[" || char === "{") {
      depth++;
    } else if ((char === "]" || char === "}") && --depth === 0) {
      return i + 1;
    }
  }
  throw new Error("ECR page has an unterminated JSON array");
}

/**
 * Next.js inlines its React payload as `self.__next_f.push([1, "…"])` scripts whose strings are
 * consecutive pieces of one text. Each array is bracket-matched, so a ")</script>" inside a
 * string can't end it early, and the search resumes after it.
 */
function flightText(html: string): string {
  const push = /<script\b[^>]*>\s*self\.__next_f\.push\((?=\[)/g;
  const pieces: string[] = [];
  for (let match = push.exec(html); match; match = push.exec(html)) {
    const end = closingBracket(html, push.lastIndex);
    const chunk: unknown = JSON.parse(html.slice(push.lastIndex, end));
    if (Array.isArray(chunk) && chunk[0] === 1 && typeof chunk[1] === "string") pieces.push(chunk[1]);
    push.lastIndex = end;
  }
  return pieces.join("");
}

export function extractInitialJobs(html: string): { jobs: unknown[]; dataState: string | undefined } {
  const flight = flightText(html);
  const at = flight.indexOf(JOBS);
  if (at < 0) throw new Error("ECR page has no initialJobs");
  const start = at + JOBS.length - 1;
  const jobs = JSON.parse(flight.slice(start, closingBracket(flight, start))) as unknown[];
  return { jobs, dataState: DATA_STATE.exec(flight)?.[1] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** React doubles a leading "$" in payload strings, since "$…" marks its references. */
function text(value: unknown): string {
  if (typeof value !== "string") return "";
  return cleanText(value.startsWith("$$") ? value.slice(1) : value);
}

/** Undefined when the job has no id, usable apply URL or posted day. */
export function ecrListing(job: unknown): Listing | undefined {
  if (!isRecord(job) || typeof job.id !== "string" || typeof job.applyUrl !== "string") return undefined;
  const url = cleanUrl(job.applyUrl);
  const postedDay = ecrPostedDay(job.postedAt, job.firstSeenAt);
  if (!url || !postedDay) return undefined;
  const title = text(job.title);
  const category = typeof job.track === "string" ? job.track : null;
  return {
    sourceId: job.id,
    url,
    key: canonicalKey(url),
    company: text(job.company),
    title,
    // "San Jose · 6 Locations": the count stands in for locations ECR doesn't list.
    locations: text(job.location)
      .split(" · ")
      .filter((location) => location && !/^\d+ locations?$/i.test(location)),
    category,
    postedDay,
    software: isSoftware({ category, title }),
    internship: isInternship(title, url),
    active: job.closed !== true,
    raw: JSON.stringify(job),
  };
}

/** The whole summer board in one page; ECR sends no ETag, so every run downloads it. */
export function ecrSource(url = ECR_URL, { minJobs = 1000 }: { minJobs?: number } = {}): JobSource {
  return {
    name: "ecr",
    source: "ecr",
    minIntervalMinutes: 55,
    async fetchListings(): Promise<FetchResult> {
      const response = await get(url, { acceptEncoding: "br, gzip", timeoutMs: 60_000 });
      if (response.status !== 200) throw new Error(`${url}: unexpected HTTP ${response.status}`);
      const { jobs, dataState } = extractInitialJobs(response.body);
      if (jobs.length < minJobs) throw new Error(`${url}: only ${jobs.length} jobs, expected at least ${minJobs}`);
      const listings = jobs.map(ecrListing).filter((listing) => listing !== undefined);
      const skipped = jobs.length - listings.length;
      if (skipped > jobs.length * MAX_SKIPPED) {
        throw new Error(`${url}: ${skipped} of ${jobs.length} jobs have no usable apply URL or date`);
      }
      return { changed: true, listings, complete: dataState === "live", skipped, detail: dataState ?? "unknown" };
    },
  };
}
