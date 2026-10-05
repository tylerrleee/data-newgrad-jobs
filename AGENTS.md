# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

jobbo polls a handful of public new-grad job feeds (GitHub READMEs/JSON, a scraped page), keeps
only US-eligible, bachelor's-eligible, entry-level data science / data analyst / data engineering / quant
roles (for a May 2027 graduate), deduplicates the same job across sources,
and posts each new one to Slack exactly once (threading reposts of the same company+title together).
Runtime is Bun + TypeScript, storage is SQLite (`bun:sqlite`), no build step, no frontend.

Read `README.md` first — it documents the pipeline steps, the source table, the Slack setup, and the
`.env` variables in detail; this file only covers what the README doesn't.

## Commands

```sh
bun install              # install deps (or: nix develop / direnv allow, then bun install)
bun start                 # one real run (fetch feeds, post new jobs to Slack)
bun run watch              # run now, then every 60 min until Ctrl-C (--every <minutes> to change)
bun run dry-run            # fetch + ingest for real, log what would post, nothing sent, DB posting state rolled back
bun run sample              # post 4 fake jobs to Slack, to check the app/channel/message layout
bun test                    # run all tests (Bun's test runner)
bun test test/degree.test.ts   # run a single test file
bun test -t "pattern"          # run tests whose name matches pattern
bun run typecheck            # tsc --noEmit
bun src/index.ts --requeue <job id>...     # claimed job never reached Slack: post it next run
bun src/index.ts --mark-posted <id> [ts]   # claimed job did reach Slack (ts optional, makes it a thread parent)
bun src/index.ts --help
```

There is no lint script; typechecking (`bun run typecheck`) and `bun test` are the checks to run after
changes. Tests stub `fetch` to reject any non-localhost request (`test/setup.ts`) — sources under test
must be fed fixtures, never the network.

## Architecture

**Pipeline, one run (`src/run.ts` → `runOnce`):**
1. `runFeeds` (`src/feeds.ts`) iterates `sources` (`src/sources/index.ts`), skipping any feed not yet
   due (`minIntervalMinutes` per source, tracked in the `feeds` table). Each source's `fetchListings`
   gets an `FetchContext` (stored ETag, last success/full-fetch time, previously stored raw row per
   `sourceId`) and returns either "unchanged" or a full `FetchResult` with `Listing[]`.
2. Changed feeds are passed to `ingest` (`src/ingest.ts`), which upserts into `listings` keyed by
   `(feed, source_id)` and resolves each listing to a `jobs` row via `canonicalKey(url)`
   (`src/canonical.ts`) — the same requisition from different sources collapses to one job. A listing
   whose job has no other active listings and reappears ≥`REPOST_DAYS` (30) after the job's last
   posting is treated as a new requisition, not the same job. When a feed snapshot is `complete`,
   listings missing from it are marked inactive — unless more than 30% of previously-active listings
   would disappear at once, in which case only listings missing 48h+ are deactivated (a guard against
   a partial/broken fetch being read as "everything closed"). `refreshJob` recomputes each touched
   job's display fields (company/title/url/locations) by picking the best listing per `SOURCE_PRIORITY`
   / `LOCATION_PRIORITY` (`src/job.ts`), since sources disagree on formatting.
3. `postPending` (`src/post.ts`) selects jobs not yet decided, applies `classify.ts` (data role +
   entry level only), `region.ts` (US-or-unclear only, unless `JOBBO_POST_INTERNATIONAL=1`), and
   `degree.ts` (hold back grad-degree-only and high-school-only roles) to move each job to `expired` / `held`
   / `eligible`, then posts eligible ones to Slack via the `SlackPoster` interface (`src/slack.ts`),
   up to `JOBBO_MAX_POSTS_PER_RUN` per run. Same company+title within `THREAD_WINDOW_DAYS` of a
   previous post are threaded as a reply instead of a new top-level message.
4. A job about to be posted is marked `claimed` *before* the Slack call; if the process crashes or the
   call times out mid-flight, that job surfaces in the log as possibly-not-delivered, and the operator
   resolves it with `--requeue` (not actually posted → post it next run) or `--mark-posted` (it did
   post → stop retrying, optionally record the Slack `ts` so later reposts thread onto it). This
   claim-before-send ordering is what makes the posting step safe to crash mid-run.

**Adding a new source**: implement `JobSource` (`src/job.ts`) — `name`, `source` (add to `SourceName`
and its two priority arrays), `minIntervalMinutes`, and `fetchListings`. Put it in `src/sources/`, wire
it into `src/sources/index.ts`. Use `FetchContext.storedRaw` to compare against previously-seen raw
data/ETags and return `{ changed: false }` cheaply (jobbo is designed to minimize requests). Each
`Listing.key` must come from `canonicalKey`/`cleanUrl` (`src/canonical.ts`) so cross-source dedup works;
if a source's URLs don't map cleanly to a known ATS pattern, `canonicalKey` falls back to a generic
per-host key, and `ingest.ts` only trusts generic keys within the same company.

**Dry runs vs real runs**: `--dry-run` fetches and ingests for real (so feed state/ETags/the `jobs` and
`listings` tables advance normally) but wraps the *posting* step in a SQLite transaction that is always
rolled back, so no posting state changes and a subsequent real run posts the same plan the dry run
showed.

**Key modules**: `db.ts` (schema + queries), `job.ts` (shared types: `Listing`, `JobSource`,
`SourceName`, priorities), `canonical.ts` (per-ATS URL → dedup key, e.g. Greenhouse/Workday/Lever/
Ashby/iCIMS — bump `CANONICAL_VERSION` when changing the key logic so stored keys get recomputed),
`classify.ts` / `region.ts` / `degree.ts` (the three eligibility filters described in the README),
`text.ts` (company/title normalization used for matching, independent from canonical URL keys),
`dates.ts` (all "day" values are `YYYY-MM-DD` in `America/New_York`), `http.ts` (`HttpError`, fetch
helpers, ETag/range support), `slack.ts` (`SlackPoster` interface + real + `renderJob` message
formatting), `watch.ts` (the `--watch` loop and its double-Ctrl-C handling).
