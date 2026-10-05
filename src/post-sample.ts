// Posts a few made-up jobs to check the Slack setup and message layout. Doesn't touch the database.
import { slackConfig } from "./config.ts";
import { createSlackPoster, type JobMessage } from "./slack.ts";

const samples: Omit<JobMessage, "sources" | "moreInThread">[] = [
  {
    company: "Jobbo Test Co.",
    title: "Sample Data Analyst - New Grad 2027",
    url: "https://example.com/jobs/sample?team=a&level=new-grad",
    locations: ["Remote"],
  },
  {
    company: "Northwind Analytics",
    title: "Data Scientist I",
    url: "https://example.com/jobs/northwind-data-science",
    locations: ["New York, NY", "Boston, MA"],
  },
  {
    company: "Contoso Robotics",
    title: "Associate Data Engineer",
    url: "https://example.com/jobs/contoso-data-engineering",
    locations: ["Pittsburgh, PA", "San Francisco, CA", "Austin, TX", "Seattle, WA", "Remote"],
  },
  {
    company: "Fabrikam Cloud",
    title: "Quantitative Researcher",
    url: "https://example.com/jobs/fabrikam-quant",
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
