import { canonicalKey, cleanUrl } from "../canonical.ts";
import { isDataRole, isEntryLevel } from "../classify.ts";
import { zapplyPostedDay } from "../dates.ts";
import { get, redirectTarget } from "../http.ts";
import type { FetchContext, JobSource, Listing } from "../job.ts";
import { cleanText } from "../text.ts";

export const ZAPPLY_URL = "https://raw.githubusercontent.com/zapplyjobs/New-Grad-Jobs-2027/main/README.md";
export const ZAPPLY_LINKS = "https://zapply.jobs/l/d/";

const HEADER = "| Company | Role | Location | Posted | Visa | **Apply** |";
const SECTION = /<summary>.*<strong>(.+?)<\/strong>/;
const SEPARATOR = /^\|(\s*:?-+:?\s*\|)+$/;
const LINK = /\(https:\/\/zapply\.jobs\/l\/d\/([\w.~-]+)\/?(?:\?[^)]*)?\)/;
const UNDATED = "Date unknown";
const MAX_SKIPPED_SHARE = 0.05;
/** New links are followed a few at a time and at most this many per run; the rest wait for the next run. */
const RESOLVE_CONCURRENCY = 4;
const MAX_NEW_LINKS = 150;

export interface ZapplyRow {
  /** The zapply link's last path segment, e.g. "greenhouse-waymo-8234670"; stable across builds. */
  slug: string;
  company: string;
  title: string;
  location: string;
  /** The README section, e.g. "Software Engineering". */
  section: string;
  age: string;
  raw: string;
}

/** Reads the rows of every section's table; throws if a table header changed. */
export function parseZapply(markdown: string): { rows: ZapplyRow[]; skipped: number } {
  const rows: ZapplyRow[] = [];
  let skipped = 0;
  let section: string | undefined;
  let inTable = false;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = SECTION.exec(line);
    if (heading) {
      section = cleanText(heading[1]!);
      inTable = false;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("| Company |")) {
      if (trimmed !== HEADER) throw new Error(`unexpected ${section} table header: ${trimmed}`);
      inTable = true;
      continue;
    }
    if (!inTable || SEPARATOR.test(trimmed)) continue;
    if (!trimmed.startsWith("|")) {
      inTable = false;
      continue;
    }
    // Cells are read from the end so that a "|" inside the title stays in the title.
    const cells = trimmed.slice(1).replace(/\|$/, "").split("|");
    const slug = LINK.exec(cells.at(-1)!)?.[1];
    if (cells.length < 6 || slug === undefined || section === undefined) {
      skipped++;
      continue;
    }
    rows.push({
      slug,
      company: cleanText(cells[0]!.replaceAll("**", "")),
      title: cleanText(cells.slice(1, -4).join("|")),
      location: cleanText(cells.at(-4)!),
      section,
      age: cleanText(cells.at(-3)!),
      raw: line,
    });
  }
  if (rows.length === 0 && skipped === 0) throw new Error("no job tables in the README (format change?)");
  return { rows, skipped };
}

/** The employer URL stored with a row on an earlier run. */
function storedUrl(ctx: FetchContext, slug: string): string | undefined {
  const raw = ctx.storedRaw(slug);
  if (raw === undefined) return undefined;
  try {
    const { url } = JSON.parse(raw) as { url?: unknown };
    return typeof url === "string" ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * zapply lists the newest 100 new-grad jobs of each of six sections, each linked through a zapply.jobs
 * redirect. Each new link is followed once to its employer URL, which is kept in the row's raw text.
 * Its dates are the ATS's current ones, so a Workday repost shows up as a new job.
 */
export function zapplySource(
  url = ZAPPLY_URL,
  { links = ZAPPLY_LINKS, minRows = 100 }: { links?: string; minRows?: number } = {},
): JobSource {
  // Links that lead back to zapply's own pages are for jobs it no longer has. They stay in the
  // README for days, so they are remembered while the process runs instead of followed every run.
  const deadLinks = new Set<string>();

  async function resolve(slugs: string[]) {
    const urls = new Map<string, string>();
    const errors: string[] = [];
    let dead = 0;
    const queue = [...slugs];
    const worker = async () => {
      for (let slug = queue.shift(); slug !== undefined; slug = queue.shift()) {
        try {
          const target = await redirectTarget(`${links}${slug}/`, 15_000);
          if (new URL(target).origin === new URL(links).origin) {
            deadLinks.add(slug);
            dead++;
            continue;
          }
          const clean = cleanUrl(target);
          if (clean === undefined) throw new Error(`${slug}: redirect is not an http(s) URL`);
          urls.set(slug, clean);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    };
    await Promise.all(Array.from({ length: RESOLVE_CONCURRENCY }, worker));
    return { urls, errors, dead };
  }

  return {
    name: "zapply-newgrad",
    source: "zapply",
    minIntervalMinutes: 20,
    async fetchListings(ctx) {
      const response = await get(url, { acceptEncoding: "gzip", etag: ctx.etag, timeoutMs: 30_000 });
      if (response.status === 304) return { changed: false };
      const parsed = parseZapply(response.body);
      if (parsed.rows.length < minRows) {
        throw new Error(`only ${parsed.rows.length} rows, expected at least ${minRows}`);
      }
      let skipped = parsed.skipped;
      let undated = 0;
      const dated: { row: ZapplyRow; postedDay: string }[] = [];
      for (const row of parsed.rows) {
        const postedDay = zapplyPostedDay(ctx.now, row.age);
        if (postedDay) dated.push({ row, postedDay });
        else if (row.age === UNDATED) undated++;
        else skipped++;
      }
      const total = parsed.rows.length + parsed.skipped;
      if (skipped > total * MAX_SKIPPED_SHARE) {
        throw new Error(`${skipped} of ${total} rows have no zapply link or readable age`);
      }

      const urls = new Map<string, string>();
      const unknown = new Set<string>();
      // Newest first, so a run that hits the cap takes the freshest jobs.
      for (const { row } of dated.toSorted((a, b) => b.postedDay.localeCompare(a.postedDay))) {
        const known = storedUrl(ctx, row.slug);
        if (known !== undefined) urls.set(row.slug, known);
        else if (!deadLinks.has(row.slug)) unknown.add(row.slug);
      }
      const batch = [...unknown].slice(0, MAX_NEW_LINKS);
      const resolved = await resolve(batch);
      if (batch.length >= 3 && resolved.errors.length === batch.length) {
        throw new Error(`none of ${batch.length} new zapply links resolved, e.g. ${resolved.errors[0]}`);
      }
      for (const [slug, target] of resolved.urls) urls.set(slug, target);

      const listings: Listing[] = [];
      for (const { row, postedDay } of dated) {
        const target = urls.get(row.slug);
        if (target === undefined) continue;
        listings.push({
          sourceId: row.slug,
          url: target,
          key: canonicalKey(target),
          company: row.company,
          title: row.title,
          locations: row.location ? [row.location] : [],
          category: row.section,
          postedDay,
          // The sections are too broad to count: "Software Engineering" holds test and quality engineering.
          roleMatch: isDataRole({ category: null, title: row.title }),
          entryLevel: isEntryLevel(row.title, target),
          active: true,
          raw: JSON.stringify({ row: row.raw, url: target }),
        });
      }
      const detail = [
        resolved.urls.size > 0 ? `${resolved.urls.size} new links resolved` : undefined,
        resolved.dead > 0 ? `${resolved.dead} lead to no job` : undefined,
        resolved.errors.length > 0 ? `${resolved.errors.length} failed` : undefined,
        unknown.size > batch.length ? `${unknown.size - batch.length} left for the next run` : undefined,
        undated > 0 ? `${undated} undated rows ignored` : undefined,
      ].filter(Boolean);
      const unfinished = unknown.size > batch.length || resolved.errors.length > 0;
      // A row leaving the README has only been pushed out by newer ones, but a listing that stays
      // active forever would hide reposts of its job, so missing rows are marked inactive. While
      // links are left to follow, the ETag is held back so the next run reads the README again.
      return {
        changed: true,
        listings,
        complete: true,
        etag: unfinished ? undefined : response.etag,
        skipped,
        detail: detail.length > 0 ? detail.join(", ") : undefined,
      };
    },
  };
}
