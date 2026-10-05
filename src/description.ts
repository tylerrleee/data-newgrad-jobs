import type { Database } from "bun:sqlite";
import { canonicalKey } from "./canonical.ts";
import { saveDescription } from "./db.ts";
import { get, HttpError, redirectTarget } from "./http.ts";
import type { Log } from "./log.ts";
import { holdReason, type ListingRow } from "./post.ts";

const TIMEOUT_MS = 15_000;
/** The first run after a gap can find many jobs; the rest are fetched on later runs. */
const MAX_PER_RUN = 100;
const PACE_MS = 250;

/** The text of a job posting, or unavailable when jobbo can't read postings on its site. */
export type Description = { status: "ok"; text: string } | { status: "unavailable" };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? entity;
    const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/** One line per paragraph, heading and list item, so experience.ts can tell sections apart. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/?(br|p|div|h\d|ul|ol|li|tr|section)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t ​]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    // <li><p>…</p></li> leaves the dash on a line of its own.
    .replace(/(^|\n)- ?\n/g, "$1- ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A public API that returns one posting, and how to read its text. */
export interface Endpoint {
  url: string;
  read(body: string): string | undefined;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function greenhouse(id: string, board: string): Endpoint {
  return {
    url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${id}`,
    // "content" is HTML with its markup escaped once more.
    read: (body) => {
      const job: unknown = JSON.parse(body);
      return isRecord(job) ? htmlToText(decodeEntities(string(job.content))) : undefined;
    },
  };
}

/** The board of a job on a Greenhouse page: /<board>/jobs/<id>, or ?for=<board> on embeds. */
export function greenhouseBoard(url: URL): string | undefined {
  const named = url.searchParams.get("for");
  if (named) return named;
  if (!/(^|\.)greenhouse\.io$/.test(url.hostname)) return undefined;
  return /^\/([^/]+)\/jobs\/\d+/.exec(url.pathname)?.[1];
}

/**
 * Where to read the posting behind an apply URL, for Greenhouse, Lever, Ashby and Workday.
 * Greenhouse jobs on company career sites also need `board` (see fetchDescription).
 */
export function endpoint(jobUrl: string, board?: string): Endpoint | undefined {
  let url: URL;
  try {
    url = new URL(jobUrl);
  } catch {
    return undefined;
  }
  const key = canonicalKey(jobUrl);
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (key.startsWith("gh:")) {
    const found = board ?? greenhouseBoard(url);
    return found === undefined ? undefined : greenhouse(key.slice(3), found);
  }
  const lever = /^jobs\.(eu\.)?lever\.co$/.exec(host);
  if (lever && segments.length >= 2 && UUID.test(segments[1]!)) {
    return {
      url: `https://api.${lever[1] ?? ""}lever.co/v0/postings/${segments[0]}/${segments[1]!.toLowerCase()}`,
      read: (body) => {
        const job: unknown = JSON.parse(body);
        if (!isRecord(job)) return undefined;
        const lists = Array.isArray(job.lists) ? job.lists.filter(isRecord) : [];
        return [
          string(job.descriptionPlain),
          ...lists.map((list) => `${string(list.text)}\n${htmlToText(string(list.content))}`),
          string(job.additionalPlain),
        ].join("\n");
      },
    };
  }
  if (host === "jobs.ashbyhq.com" && segments.length >= 2 && UUID.test(segments[1]!)) {
    const id = segments[1]!.toLowerCase();
    // Ashby only lists a whole board, so the job is picked out of it.
    return {
      url: `https://api.ashbyhq.com/posting-api/job-board/${segments[0]}`,
      read: (body) => {
        const board: unknown = JSON.parse(body);
        const jobs = isRecord(board) && Array.isArray(board.jobs) ? board.jobs.filter(isRecord) : [];
        const job = jobs.find((candidate) => string(candidate.id).toLowerCase() === id);
        return job && htmlToText(string(job.descriptionHtml));
      },
    };
  }
  const workday = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/.exec(host);
  if (workday) {
    // /[en-US/]<site>/job/<location>/<title>_<requisition>[/apply]
    const start = /^[a-z]{2}-[a-z]{2}$/i.test(segments[0] ?? "") ? 1 : 0;
    const site = segments[start];
    const rest = segments.slice(start + 1);
    if (rest[0] !== "job" || rest.length < 2) return undefined;
    while (rest.length > 2 && /^apply/i.test(rest.at(-1)!)) rest.pop();
    return {
      url: `https://${host}/wday/cxs/${workday[1]}/${site}/${rest.join("/")}`,
      read: (body) => {
        const job: unknown = JSON.parse(body);
        const info = isRecord(job) && isRecord(job.jobPostingInfo) ? job.jobPostingInfo : undefined;
        return info && htmlToText(string(info.jobDescription));
      },
    };
  }
  return undefined;
}

/**
 * Reads the posting behind any of a job's URLs. Throws on network and HTTP errors, so the job is
 * tried again on a later run.
 */
export async function fetchDescription(urls: string[]): Promise<Description> {
  const read = async (found: Endpoint) => {
    const response = await get(found.url, { acceptEncoding: "gzip, deflate", timeoutMs: TIMEOUT_MS });
    return response.status === 304 ? undefined : found.read(response.body)?.trim();
  };
  for (const url of urls) {
    const found = endpoint(url);
    const text = found && (await read(found));
    if (text) return { status: "ok", text };
  }
  // Only Greenhouse jobs on company career sites are left; the embed page redirects to one that
  // names the job's board. That costs a request, so a URL with the board in it goes first.
  for (const url of urls) {
    const key = canonicalKey(url);
    if (!key.startsWith("gh:") || endpoint(url)) continue;
    const target = await redirectTarget(`https://boards.greenhouse.io/embed/job_app?token=${key.slice(3)}`, TIMEOUT_MS);
    const board = greenhouseBoard(new URL(target));
    const found = board === undefined ? undefined : endpoint(url, board);
    const text = found && (await read(found));
    if (text) return { status: "ok", text };
  }
  return { status: "unavailable" };
}

export interface DescribeOptions {
  now: Date;
  /** The first day postPending would still post (postWindowStart). */
  since: string;
  postInternational: boolean;
  log: Log;
  fetch?: (urls: string[]) => Promise<Description>;
  paceMs?: number;
}

/**
 * Fetches the posting of every job postPending may post next and hasn't been read yet, so it can
 * hold back jobs that ask for years of experience. Runs outside dry-run rollbacks: the postings
 * are kept either way.
 */
export async function describePending(db: Database, options: DescribeOptions): Promise<void> {
  const jobs = db
    .query<{ id: number; url: string }, { since: string }>(
      `SELECT id, url FROM jobs
       WHERE post_state IN ('new', 'pending') AND relevant = 1 AND active = 1 AND posted_day >= $since
         AND id NOT IN (SELECT job_id FROM descriptions)
       ORDER BY posted_day, first_seen_at, id`,
    )
    .all({ since: options.since });
  const listingsOf = db.query<ListingRow & { url: string }, { id: number }>(
    "SELECT feed, source, title, locations, raw, url FROM listings WHERE job_id = $id",
  );
  const read = options.fetch ?? fetchDescription;
  const counts = { ok: 0, unavailable: 0, failed: 0 };
  let tried = 0;
  for (const job of jobs) {
    const listings = listingsOf.all({ id: job.id });
    // Jobs held back for another reason are never posted, so their postings aren't needed.
    if (holdReason(listings, options.postInternational) !== undefined) continue;
    if (tried++ >= MAX_PER_RUN) break;
    try {
      const description = await read([...new Set([job.url, ...listings.map((listing) => listing.url)])]);
      saveDescription(db, job.id, description, options.now);
      counts[description.status]++;
    } catch (error) {
      // A site that refuses (403) or no longer has the posting (404) will answer the same next time.
      if (error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        saveDescription(db, job.id, { status: "unavailable" }, options.now);
        counts.unavailable++;
      } else {
        counts.failed++;
        options.log.warn(`could not read the posting of job ${job.id} (${job.url}): ${String(error)}`);
      }
    }
    await Bun.sleep(options.paceMs ?? PACE_MS);
  }
  if (tried > 0) {
    options.log.info(
      `postings: read ${counts.ok}, ${counts.unavailable} on sites jobbo can't read` +
        (counts.failed > 0 ? `, ${counts.failed} failed (tried again next run)` : "") +
        (tried > MAX_PER_RUN ? `, the rest wait for the next run` : ""),
    );
  }
}
