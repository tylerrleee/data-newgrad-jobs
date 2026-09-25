import { config } from "./config.ts";
import { SeenJobs } from "./seen.ts";
import { createSlackClient, postJob } from "./slack.ts";
import { sources } from "./sources/index.ts";

const seen = new SeenJobs(config.dbPath);
const slack = createSlackClient(config.slackBotToken);

for (const source of sources) {
  let jobs;
  try {
    jobs = await source.fetchJobs();
  } catch (error) {
    console.error(`${source.name}: failed to fetch jobs`, error);
    process.exitCode = 1;
    continue;
  }

  const newJobs = jobs.filter((job) => !seen.has(`${source.name}:${job.id}`));
  for (const job of newJobs) {
    const ts = await postJob(slack, config.slackChannelId, job);
    seen.add(`${source.name}:${job.id}`, config.slackChannelId, ts);
  }
  console.log(`${source.name}: ${jobs.length} jobs, ${newJobs.length} new`);
}
