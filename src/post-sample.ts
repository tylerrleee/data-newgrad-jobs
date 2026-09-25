// Posts a few made-up jobs to check the Slack setup and message layout. Doesn't touch the database.
import { slackConfig } from "./config.ts";
import { createSlackPoster, type JobMessage } from "./slack.ts";

const samples: Omit<JobMessage, "sources" | "moreInThread">[] = [
  {
    company: "Jobbo Test Co.",
    title: "Sample Software Engineer Intern",
    url: "https://example.com/jobs/sample?team=a&level=intern",
    locations: ["Remote"],
  },
  {
    company: "Northwind Analytics",
    title: "Data Science Intern (Summer 2027)",
    url: "https://example.com/jobs/northwind-data-science",
    locations: ["New York, NY", "Boston, MA"],
  },
  {
    company: "Contoso Robotics",
    title: "Machine Learning Engineer Intern",
    url: "https://example.com/jobs/contoso-ml",
    locations: ["Pittsburgh, PA", "San Francisco, CA", "Austin, TX", "Seattle, WA", "Remote"],
  },
  {
    company: "Fabrikam Cloud",
    title: "Site Reliability Engineering Intern",
    url: "https://example.com/jobs/fabrikam-sre",
    locations: [],
  },
];

const { token, channel } = slackConfig();
const poster = createSlackPoster(token, channel);
for (const [index, sample] of samples.entries()) {
  // chat.postMessage allows about one message per second per channel.
  if (index > 0) await Bun.sleep(1100);
  await poster.post({ ...sample, sources: ["Simplify"], moreInThread: 0 });
}
console.log(`Posted ${samples.length} sample jobs to ${channel}`);
