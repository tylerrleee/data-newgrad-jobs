const TIME_ZONE = "America/New_York";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar day of an instant in New York, as YYYY-MM-DD. */
export function etDay(instant: Date): string {
  return dayFormat.format(instant);
}

/** A real YYYY-MM-DD date; Date.parse alone rolls "2026-02-30" over to March 2. */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(day) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

const ECR_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/** Parses Postgres-style timestamps such as "2026-09-24 16:19:50.23751+00". */
export function parseEcrTimestamp(text: unknown): Date | undefined {
  if (typeof text !== "string") return undefined;
  const match = ECR_TIMESTAMP.exec(text.trim());
  if (!match || !isDay(match[1])) return undefined;
  const [, day, time, fraction = "", offset = ""] = match;
  const zone = offset === "Z" ? "Z" : `${offset.slice(0, 3)}:${offset.slice(3).replace(":", "") || "00"}`;
  const ms = Date.parse(`${day}T${time}${fraction.slice(0, 4)}${zone}`);
  return Number.isNaN(ms) ? undefined : new Date(ms);
}

/** ECR's ATS posting date, or the day ECR first saw the job. */
export function ecrPostedDay(postedAt: unknown, firstSeenAt: unknown): string | undefined {
  if (isDay(postedAt)) return postedAt;
  const seen = parseEcrTimestamp(firstSeenAt);
  return seen && etDay(seen);
}

/** Simplify stores ATS dates as midnight UTC; anything else is a real instant. */
export function simplifyPostedDay(epochSeconds: unknown): string | undefined {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return undefined;
  }
  const instant = new Date(epochSeconds * 1000);
  return epochSeconds % 86_400 === 0 ? instant.toISOString().slice(0, 10) : etDay(instant);
}

const REGENERATION_CUTOFF_MS = (12 * 60 + 30) * 60_000;

/**
 * speedyapply ages ("3d") count days back from the file's daily regeneration, a UTC cron that lands
 * between 12:48Z and 22:06Z (08:48 EDT, but 07:48 EST). A version first fetched before 12:30Z is
 * from the previous day. The commit's UTC and New York days are the same.
 */
export function speedyapplyPostedDay(fetchedAt: Date, age: string): string | undefined {
  const match = /^(\d{1,4})d$/.exec(age.trim());
  if (!match) return undefined;
  const generated = new Date(fetchedAt.getTime() - REGENERATION_CUTOFF_MS).toISOString().slice(0, 10);
  return addDays(generated, -Number(match[1]));
}
