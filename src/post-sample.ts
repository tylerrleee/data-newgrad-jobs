// Posts a made-up job to check the Slack setup. Doesn't record it as seen.
import { config } from "./config.ts";
import { createSlackClient, postJob } from "./slack.ts";

const slack = createSlackClient(config.slackBotToken);
await postJob(slack, config.slackChannelId, {
  id: "sample",
  title: "Sample Software Engineer",
  company: "Jobbo Test Co.",
  location: "Remote",
  url: "https://example.com/jobs/sample",
});
console.log(`Posted a sample job to ${config.slackChannelId}`);
