import { WebClient, type KnownBlock } from "@slack/web-api";
import type { Job } from "./job.ts";

export function createSlackClient(token: string): WebClient {
  return new WebClient(token);
}

/** Posts a job to the channel and returns the message's `ts`. */
export async function postJob(client: WebClient, channel: string, job: Job): Promise<string> {
  const result = await client.chat.postMessage({
    channel,
    // Shown in notifications and anywhere blocks can't be rendered.
    text: `${job.title} at ${job.company}`,
    blocks: jobBlocks(job),
    unfurl_links: false,
  });
  if (!result.ts) {
    throw new Error(`chat.postMessage returned no ts for ${job.url}`);
  }
  return result.ts;
}

function jobBlocks(job: Job): KnownBlock[] {
  const details = [job.company, job.location].filter(Boolean).join(" · ");
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*<${job.url}|${escapeMrkdwn(job.title)}>*\n${escapeMrkdwn(details)}`,
      },
    },
  ];
}

// https://docs.slack.dev/messaging/formatting-message-text#escaping
function escapeMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
