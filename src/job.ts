export type SourceName = "ecr" | "simplify" | "speedyapply" | "zshah" | "zapply";

export const SOURCE_LABELS: Record<SourceName, string> = {
  ecr: "Early Career Radar",
  simplify: "Simplify",
  speedyapply: "speedyapply",
  zshah: "zshah101",
  zapply: "Zapply",
};

/**
 * Whose company and title to show when several sources list a job: employer text first. zshah101
 * and zapply come last because zapply gives legal names ("Amazon.com Services LLC").
 */
export const SOURCE_PRIORITY: SourceName[] = ["ecr", "speedyapply", "simplify", "zshah", "zapply"];

/**
 * Whose locations to show: Simplify and speedyapply tidy them, ECR and zshah101 copy the ATS's
 * text, and zapply cuts long ones short ("Greenville, South Carolina,...").
 */
export const LOCATION_PRIORITY: SourceName[] = ["simplify", "speedyapply", "ecr", "zshah", "zapply"];

/** One row of one feed. */
export interface Listing {
  /** Unique within its feed and stable across runs. */
  sourceId: string;
  url: string;
  /** canonicalKey(url): the same job in any source has the same key. */
  key: string;
  company: string;
  title: string;
  locations: string[];
  category: string | null;
  /** YYYY-MM-DD, America/New_York. */
  postedDay: string;
  software: boolean;
  internship: boolean;
  active: boolean;
  raw: string;
}

export type FetchResult =
  | { changed: false; nextAttemptAt?: Date; detail?: string }
  | {
      changed: true;
      listings: Listing[];
      /** The listings are the feed's whole current state, so missing ones can be marked inactive. */
      complete: boolean;
      etag?: string;
      full?: boolean;
      nextAttemptAt?: Date;
      /** Rows dropped because a URL or date couldn't be parsed. */
      skipped: number;
      detail?: string;
    };

export interface FetchContext {
  now: Date;
  etag: string | undefined;
  lastSuccessAt: Date | undefined;
  lastFullAt: Date | undefined;
  /** The raw row stored for a listing of this feed, if any. */
  storedRaw(sourceId: string): string | undefined;
}

export interface JobSource {
  /** Unique feed name; keys all per-feed state in the database. */
  name: string;
  source: SourceName;
  minIntervalMinutes: number;
  fetchListings(ctx: FetchContext): Promise<FetchResult>;
}
