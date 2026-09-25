import { parseArgs } from "node:util";
import { config, slackConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { createLog } from "./log.ts";
import { markPosted, requeue } from "./post.ts";
import { printingPoster, runOnce } from "./run.ts";
import { createSlackPoster } from "./slack.ts";
import { sources } from "./sources/index.ts";
import { watch } from "./watch.ts";

const USAGE = `usage:
  bun src/index.ts [--dry-run]                  run once
  bun src/index.ts --watch [--every <minutes>]  run now and then every 60 (or <minutes>) minutes until Ctrl-C
  bun src/index.ts --requeue <job id>...        a claimed job never reached Slack: post it next run
  bun src/index.ts --mark-posted <id> [ts]      a claimed job did reach Slack`;

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
    watch: { type: "boolean", default: false },
    every: { type: "string", default: "60" },
    requeue: { type: "boolean", default: false },
    "mark-posted": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const log = createLog(config.logFile || undefined);
const db = openDb(config.dbPath);

// For jobs a crashed or timed-out run left "claimed": check the channel, then either
//   --requeue <id>...          the job never reached Slack; post it on the next run, or
//   --mark-posted <id> [ts]    it did; the message's ts (from its link) makes it a thread parent.
if (values.requeue) {
  const ids = positionals.map(Number);
  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id))) {
    console.error(USAGE);
    process.exit(2);
  }
  for (const job of requeue(db, ids, new Date())) log.info(`requeued ${job.id}: ${job.title} (${job.url})`);
  process.exit(0);
}
if (values["mark-posted"]) {
  const [id, ts] = positionals;
  if (!id || !Number.isInteger(Number(id))) {
    console.error(USAGE);
    process.exit(2);
  }
  const job = markPosted(db, Number(id), slackConfig().channel, ts);
  log.info(job ? `marked ${job.id} as posted: ${job.title} (${job.url})` : `job ${id} isn't claimed`);
  process.exit(job ? 0 : 1);
}

const dryRun = values["dry-run"];
const slack = dryRun ? { channel: Bun.env.SLACK_CHANNEL_ID ?? "dry-run" } : slackConfig();
const poster = "token" in slack ? createSlackPoster(slack.token, slack.channel, log) : printingPoster(log);
const run = () => runOnce(db, sources, { channel: slack.channel, poster, dryRun, log });

if (!values.watch) {
  process.exitCode = (await run()) ? 0 : 1;
} else {
  const every = Number(values.every);
  if (!Number.isFinite(every) || every < 1) {
    console.error(`--every must be a number of minutes (at least 1), got "${values.every}"\n\n${USAGE}`);
    process.exit(2);
  }
  // First Ctrl-C: finish the current run (or stop waiting) and exit. Second: exit now.
  const stop = new AbortController();
  const onSignal = (signal: string) => {
    if (stop.signal.aborted) process.exit(130);
    log.info(`${signal}: stopping after the current run (press Ctrl-C again to quit now)`);
    stop.abort();
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  log.info(
    `watching: a run every ${every} minutes${dryRun ? ", dry run" : ""}` +
      (config.logFile ? `; also logging to ${config.logFile}` : ""),
  );
  await watch(run, { everyMs: every * 60_000, log, signal: stop.signal });
  log.info("stopped");
}
