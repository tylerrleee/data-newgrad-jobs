// Posts a made-up job to check the Slack setup. Doesn't touch the database.
import { slackConfig } from "./config.ts";
import { createSlackPoster } from "./slack.ts";

const { token, channel } = slackConfig();
await createSlackPoster(token, channel).post({
  title: "Sample Software Engineer Intern",
  company: "Jobbo Test Co.",
  url: "https://example.com/jobs/sample?team=a&level=intern",
  locations: ["Remote"],
  sources: ["Simplify"],
  moreInThread: 0,
});
console.log(`Posted a sample job to ${channel}`);
