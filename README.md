# jobbo 

**(Adapted from another repo)**

jobbo collects new-grad data science, data analyst, data engineering and quant listings (for a May 2027 graduate) from a few public job lists and posts each new one to a Slack channel once.

Each run does these steps:

1. It gets the sources that are due, using as few requests as possible (ETags, and a byte range for Simplify's large JSON file).
2. It keeps entry-level data roles only. Rules in `src/classify.ts` remove internships and co-ops, senior roles ("Senior", "Lead", "Data Engineer II"), titles that name only a year before 2027 ("2026 New Grad"), data gig work (labeling, collection) and roles that aren't data science, analytics, data engineering or quant. Plain software and ML engineering roles are not posted.
3. It finds the same job in different sources by the job ID in its apply URL (Greenhouse, Workday, Lever, Ashby, iCIMS and others), so each job is stored once.
4. It does not post jobs that are only outside the US (see `src/region.ts`). A job with at least one US location is posted. A job whose location is not clear, for example "Remote", is also posted. A job title that names a place outside the US, for example "Data Analyst - Ireland", counts as a location outside the US.
5. It does not post jobs that are only for people with a graduate degree, for example "Data Scientist, PhD" or "Quant Researcher (MS/PhD)" (see `src/degree.ts`). "Graduate" alone, as in "Graduate Data Engineer", means a new graduate and is posted. If a job title names a degree level, the titles decide. If not, Simplify's degrees and ECR's student years decide. A job that lets bachelor's graduates apply in any source is posted. A job with no degree information is also posted. By the same rules, it does not post jobs that are only for high school students.
6. It posts each new job to Slack once. Jobs posted before the day of the first run are never posted, and no job older than 7 days is posted. Openings with the same company and title, posted within 3 days of each other, go into one thread.

## Sources

| Source | What jobbo reads | Checked at most every |
|---|---|---|
| [Early Career Radar](https://earlycareerradar.com/new-grad) | The new-grad page | 55 minutes |
| [SimplifyJobs/New-Grad-Positions](https://github.com/SimplifyJobs/New-Grad-Positions) | [`listings.json`](https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json) on the `dev` branch | 20 minutes |
| [speedyapply/2027-AI-College-Jobs](https://github.com/speedyapply/2027-AI-College-Jobs) | The [US new-grad table](https://raw.githubusercontent.com/speedyapply/2027-AI-College-Jobs/main/NEW_GRAD_USA.md) | 20 minutes |
| [speedyapply/2027-SWE-College-Jobs](https://github.com/speedyapply/2027-SWE-College-Jobs) | The [US new-grad table](https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/NEW_GRAD_USA.md), for the data roles in it | 20 minutes |
| [zapplyjobs/New-Grad-Jobs-2027](https://github.com/zapplyjobs/New-Grad-Jobs-2027) | The [README](https://raw.githubusercontent.com/zapplyjobs/New-Grad-Jobs-2027/main/README.md) tables: the newest 100 jobs of each section | 20 minutes |

zapply gets its jobs from the employers' ATS boards, so it often lists jobs hours before the other sources. It also lists jobs that the other sources don't have. (`src/sources/zshah.ts` reads zshah101's internship list; it is no longer wired in, since zshah101 has no new-grad list.)

Each zapply link goes through a zapply.jobs redirect. jobbo follows each new link one time to find the employer URL, and then stores it. It follows at most 150 new links per run. zapply gives each job the date that the ATS shows now, so a job that an employer posts again appears as a new job.

The feed code is in `src/sources/`. When a source fails, the other sources continue. After three failures in a row, jobbo posts an alert to the channel.

## Setup

### 1. Get the tools

The Nix flake gives a dev shell with [Bun](https://bun.sh) and the official [Slack CLI](https://github.com/slackapi/slack-cli):

```sh
nix develop        # or, with direnv: direnv allow
bun install
```

If you don't use Nix, install Bun yourself and run `bun install`.

### 2. Create the Slack app

The app is defined in `manifest.json`. It is a bot that needs only the `chat:write` scope. To install it to your workspace, use the Slack CLI:

```sh
slack login
slack install
```

You can also create the app from `manifest.json` at [api.slack.com/apps](https://api.slack.com/apps).

Then invite the bot to the channel it will post to (`/invite @Jobbo`).

### 3. Configure

```sh
cp .env.example .env
```

Fill in these values in `.env`. Bun and the direnv shell load `.env` automatically.

| Variable | Default | Meaning |
|---|---|---|
| `SLACK_BOT_TOKEN` | (required) | Bot User OAuth Token (`xoxb-…`), from the app's "OAuth & Permissions" page. `slack app settings` opens that page. |
| `SLACK_CHANNEL_ID` | (required) | The channel's ID, not its name. You find it at the bottom of the channel details, on the "About" tab. |
| `JOBBO_DB_PATH` | `jobbo.sqlite` | The SQLite database of listings and posted jobs. |
| `JOBBO_MAX_POSTS_PER_RUN` | `40` | The maximum number of messages per run. The remaining jobs wait for the next run. |
| `JOBBO_POST_SINCE` | day of the first run | Never post jobs posted before this day (`YYYY-MM-DD`). |
| `JOBBO_POST_INTERNATIONAL` | `0` | Set to `1` to also post jobs that are only outside the US. jobbo always gets and stores these jobs. |
| `JOBBO_LOG_FILE` | `jobbo.log` | Log lines are also added to this file. Set it empty to log to the terminal only. |

## Usage

```sh
bun run sample     # post four made-up jobs, to check the Slack setup and message layout
bun run dry-run    # get the sources, then log what would be posted; nothing goes to Slack
bun start          # do one run
bun run watch      # run now, then every 60 minutes until Ctrl-C
```

To use a different interval, run `bun src/index.ts --watch --every <minutes>`. Press Ctrl-C once to stop after the current run. Press it again to stop immediately.

A dry run stores the listings it gets, but it does not keep any posting state. Thus the next real run posts the same jobs that the dry run showed.

### Jobs that may not have reached Slack

jobbo never retries a post that Slack may have received, for example after a timeout. It marks the job as "claimed" and lists it in the log at the end of each run. Look in the channel, then do one of these:

```sh
bun src/index.ts --requeue <job id>...        # the job is not in Slack: post it on the next run
bun src/index.ts --mark-posted <id> [ts]      # the job is in Slack
```

For `--mark-posted`, the `ts` value is optional. It is in the message's link. If you give it, later openings like this job go into the thread of that message.

### Message format

Each post shows the company in bold, the job title as a link to the posting, and up to three locations. A divider goes below each post. A thread parent also shows how many more openings are in its thread. The sources are not shown in Slack, but the dry-run log shows them. See `renderJob` in `src/slack.ts`.

## Development

```sh
bun test
bun run typecheck
```


## Running Service
```sh
sudo systemctl daemon-reload
sudo systemctl enable --now jobbo
systemctl status jobbo
journalctl -u jobbo -f

```