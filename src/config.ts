import { isDay } from "./dates.ts";

function required(name: string): string {
  const value = Bun.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function optionalCount(name: string, fallback: number): number {
  const value = Bun.env[name];
  if (!value) return fallback;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) throw new Error(`${name} must be a whole number, got "${value}"`);
  return count;
}

function optionalDay(name: string): string | undefined {
  const value = Bun.env[name];
  if (!value) return undefined;
  if (!isDay(value)) throw new Error(`${name} must be a date like 2026-09-24, got "${value}"`);
  return value;
}

function optionalFlag(name: string): boolean {
  const value = Bun.env[name]?.toLowerCase();
  if (!value || value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  throw new Error(`${name} must be 1 or 0, got "${Bun.env[name]}"`);
}

export const config = {
  dbPath: Bun.env.JOBBO_DB_PATH ?? "jobbo.sqlite",
  maxPostsPerRun: optionalCount("JOBBO_MAX_POSTS_PER_RUN", 40),
  postSince: optionalDay("JOBBO_POST_SINCE"),
  /** Jobs whose only locations are outside the US are kept but not posted unless this is set. */
  postInternational: optionalFlag("JOBBO_POST_INTERNATIONAL"),
  /** Log lines are also appended here; set JOBBO_LOG_FILE= (empty) to log to the terminal only. */
  logFile: Bun.env.JOBBO_LOG_FILE ?? "jobbo.log",
};

/** Slack settings are only needed when actually posting. */
export function slackConfig() {
  return {
    token: required("SLACK_BOT_TOKEN"),
    channel: required("SLACK_CHANNEL_ID"),
  };
}
