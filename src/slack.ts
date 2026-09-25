import { ErrorCode, LogLevel, WebClient, type KnownBlock, type Logger } from "@slack/web-api";
import type { Log } from "./log.ts";

export interface JobMessage {
  title: string;
  company: string;
  url: string;
  locations: string[];
  /** Source labels, e.g. "Simplify". Not shown in Slack. */
  sources: string[];
  moreInThread: number;
}

export interface SlackPoster {
  /** Posts a job, as a thread reply when threadTs is given, and returns the message's ts. */
  post(message: JobMessage, threadTs?: string): Promise<string>;
  update(ts: string, message: JobMessage): Promise<void>;
  postText(text: string): Promise<void>;
}

/** Sends the Slack client's warnings and errors to our log. */
function slackLogger(log: Log): Logger {
  let level = LogLevel.WARN;
  return {
    debug() {},
    info() {},
    warn: (...message) => log.warn(`slack: ${message.join(" ")}`),
    error: (...message) => log.error(`slack: ${message.join(" ")}`),
    setLevel: (next) => {
      level = next;
    },
    getLevel: () => level,
    setName() {},
  };
}

export function createSlackPoster(token: string, channel: string, log?: Log): SlackPoster {
  // The library's default retries could post a message twice; a failed post is retried next run.
  const client = new WebClient(token, {
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
    timeout: 30_000,
    logger: log && slackLogger(log),
  });
  return {
    async post(message, threadTs) {
      const result = await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        ...renderJob(message),
        unfurl_links: false,
        unfurl_media: false,
      });
      if (!result.ts) throw new Error("chat.postMessage returned no ts");
      return result.ts;
    },
    async update(ts, message) {
      await client.chat.update({ channel, ts, ...renderJob(message) });
    },
    async postText(text) {
      await client.chat.postMessage({ channel, text: escapeMrkdwn(text), unfurl_links: false, unfurl_media: false });
    },
  };
}

const MAX_TITLE = 200;
const MAX_LOCATION = 80;
const SHOWN_LOCATIONS = 3;

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

export function renderJob(message: JobMessage): { text: string; blocks: KnownBlock[] } {
  const title = escapeMrkdwn(truncate(message.title, MAX_TITLE));
  const company = escapeMrkdwn(truncate(message.company, MAX_TITLE));
  const url = escapeMrkdwn(message.url).replaceAll("|", "%7C");
  const shown = message.locations.slice(0, SHOWN_LOCATIONS).map((location) => truncate(location, MAX_LOCATION));
  const hidden = message.locations.length - shown.length;
  const locations = escapeMrkdwn(shown.join("; ")) + (hidden > 0 ? ` +${hidden} more` : "");
  // Sources are left out of the post; the dry-run log still shows them.
  const lines = [`*${company}*`, `<${url}|${title}>`];
  if (locations) lines.push(locations);
  if (message.moreInThread > 0) {
    lines.push(`└ ${message.moreInThread} more opening${message.moreInThread === 1 ? "" : "s"} in thread`);
  }
  return {
    // Shown in notifications and anywhere blocks can't be rendered.
    text: `${title} at ${company}`,
    // The divider separates consecutive posts, which Slack otherwise runs together under one bot name.
    blocks: [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }, { type: "divider" }],
  };
}

// https://docs.slack.dev/messaging/formatting-message-text#escaping
export function escapeMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * What a failed Slack call means for the job:
 * - "retry": nothing can be posted right now (rate limit, bad token, bot not in the channel);
 *   Slack certainly didn't post it, so stop and try again next run.
 * - "failed": Slack rejected this one message; retrying it can't help, but other jobs can go ahead.
 * - "unknown": Slack may have posted it; never retry automatically.
 */
export type SlackFailure = "retry" | "failed" | "unknown";

const CHANNEL_WIDE = new Set([
  "not_in_channel", "channel_not_found", "is_archived", "invalid_auth", "not_authed", "token_revoked",
  "token_expired", "account_inactive", "missing_scope", "no_permission", "access_denied",
  "team_access_not_granted", "ekm_access_denied", "org_login_required", "restricted_action",
  "restricted_action_read_only_channel", "message_limit_exceeded", "ratelimited", "rate_limited",
]);
const MAYBE_POSTED = new Set(["fatal_error", "internal_error", "service_unavailable", "request_timeout"]);
const NEVER_CONNECTED = new Set(["ConnectionRefused", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "FailedToOpenSocket"]);

interface SlackErrorShape {
  code?: string;
  data?: { error?: string };
  original?: { code?: string };
}

export function classifySlackError(error: unknown): SlackFailure {
  const { code, data, original } = (error ?? {}) as SlackErrorShape;
  if (code === ErrorCode.RateLimitedError) return "retry";
  if (code === ErrorCode.PlatformError) {
    const reason = data?.error ?? "";
    if (CHANNEL_WIDE.has(reason)) return "retry";
    return MAYBE_POSTED.has(reason) ? "unknown" : "failed";
  }
  if (code === ErrorCode.RequestError && NEVER_CONNECTED.has(original?.code ?? "")) return "retry";
  return "unknown";
}

export function describeSlackError(error: unknown): string {
  const { code, data, original } = (error ?? {}) as SlackErrorShape;
  if (code === ErrorCode.PlatformError && data?.error) return data.error;
  if (code === ErrorCode.RequestError && original?.code) return original.code;
  return error instanceof Error ? error.message : String(error);
}
