/** Bump whenever canonicalKey's output changes; stored keys are then recomputed. */
export const CANONICAL_VERSION = 1;

const JUNK = /["<>]|%22|%3c|%3e/i;

/** Trims an apply URL and cuts trailing HTML junk; undefined unless it is an http(s) URL. */
export function cleanUrl(raw: string): string | undefined {
  let text = raw.trim();
  const junk = text.search(JUNK);
  if (junk >= 0) text = text.slice(0, junk);
  // Only a bare host gets a scheme: "careers.acme.com/jobs/1", never "/jobs/1" or "Closed".
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(text)) return undefined;
    text = `https://${text}`;
  }
  try {
    const { protocol } = new URL(text);
    return protocol === "https:" || protocol === "http:" ? text : undefined;
  } catch {
    return undefined;
  }
}

interface Parts {
  host: string;
  segments: string[];
  path: string;
  /** Lowercased parameter name → first value. */
  params: Map<string, string>;
  /** Unique name=value pairs in their original form, sorted. */
  query: [string, string][];
}

type Rule = (url: Parts) => string | undefined;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function first(pattern: RegExp, text: string | undefined): string | undefined {
  return text === undefined ? undefined : pattern.exec(text)?.[1];
}

function uuid(text: string | undefined): string | undefined {
  return text === undefined ? undefined : UUID.exec(text)?.[0].toLowerCase();
}

function isHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function label(host: string): string {
  return host.split(".")[0]!;
}

function prefixed(prefix: string, id: string | undefined): string | undefined {
  return id === undefined ? undefined : `${prefix}:${id}`;
}

const WORKDAY_HOST = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/;
const WORKDAY_SITE_HOST = /^wd\d+\.myworkdaysite\.com$/;
const WORKDAY_ACTIONS = new Set(["apply", "applymanually", "autofillwithresume", "usemylastapplication", "login"]);

/**
 * Workday links for one requisition vary by locale, career site, its case and a "-1" repost
 * suffix. The requisition id follows the first "_" of the last path segment.
 */
function workday(url: Parts): string | undefined {
  const lower = url.segments.map((segment) => segment.toLowerCase());
  let tenant = first(WORKDAY_HOST, url.host);
  if (!tenant && WORKDAY_SITE_HOST.test(url.host)) {
    // wdN.myworkdaysite.com/[en-US/]recruiting/<tenant>/...
    const at = lower.indexOf("recruiting");
    if (at === 0 || at === 1) tenant = lower[at + 1];
  }
  if (!tenant) return undefined;
  const start = Math.max(lower.lastIndexOf("job"), lower.lastIndexOf("details"));
  const rest = url.segments.slice(start + 1);
  while (rest.length > 0 && WORKDAY_ACTIONS.has(rest.at(-1)!.toLowerCase())) rest.pop();
  const last = rest.at(-1);
  if (!last?.includes("_")) return undefined;
  let requisition = last.slice(last.indexOf("_") + 1).toUpperCase();
  const repost = /^(.*)-\d$/.exec(requisition);
  if (repost && (repost[1]!.match(/\d/g)?.length ?? 0) >= 4) requisition = repost[1]!;
  return `wd:${tenant}:${requisition}`;
}

/** "twosigma" for both twosigma.avature.net and its custom domain careers.twosigma.com. */
function avatureTenant(host: string): string {
  if (isHost(host, "avature.net")) return label(host);
  const labels = host.split(".");
  return labels.slice(labels.length > 2 ? 1 : 0, -1).join(".");
}

/** Avature: /JobDetail/<n>, /JobDetail/<slug>/<n> or /JobDetail?jobId=<n>. */
function avature(url: Parts): string | undefined {
  const id =
    first(/\/jobdetail(?:\/[^/]+)?\/(\d+)(?:\/|$)/i, url.path) ??
    (/\/jobdetail$/i.test(url.path) ? first(/^(\d+)$/, url.params.get("jobid")) : undefined);
  return prefixed(`avature:${avatureTenant(url.host)}`, id);
}

/** Company career sites whose job pages show the Greenhouse id without a gh_jid param. */
const GREENHOUSE_SITES: [host: string, path: RegExp][] = [
  ["janestreet.com", /^\/join-jane-street\/(?:position|apply)\/(\d+)/],
  ["imc.com", /^\/[a-z]{2}\/careers\/jobs\/(\d+)/],
  ["voloridge.com", /^\/jobs\/[^/]+\/(\d+)/],
  ["trlm.com", /^\/apply\/(\d+)/],
  ["epicgames.com", /^\/(?:site\/)?careers\/jobs\/(\d+)/],
  ["careers.appian.com", /^\/jobs\/(\d+)/],
  ["careers.hellofresh.com", /^\/global\/en\/job\/(\d+)/],
];

/** Company career sites whose job pages show the Workday requisition: [host, path, tenant]. */
const WORKDAY_SITES: [host: string, path: RegExp, tenant: string][] = [
  // Booz Allen's Avature pages end their slug in the requisition: /jobs/JobDetail/<title>-R0248141/129566
  ["careers.boozallen.com", /\/jobdetail\/[^/]*-(r\d{7})\/\d+$/i, "bah"],
  ["careers.cisco.com", /^\/global\/en\/job\/(\d+)/, "cisco"],
];

/** Company career domains that front an ATS tenant, so both spellings of a job get one key. */
const HOST_ALIASES = new Map([
  ["careers.sig.com", "careers-sig.icims.com"],
  ["enterpriseplatform.dell.com", "iawmqy.fa.ocs.oraclecloud.com"],
  ["simventions.jibeapply.com", "careers-simventions.icims.com"],
  ["careers-aluminumdynamics.icims.com", "careers-steeldynamics.icims.com"],
  ["career.innovativesystems.com", "innovativesystems.applytojob.com"],
]);

const RULES: Rule[] = [
  // Greenhouse ids work on any host, including company career sites.
  (url) => prefixed("gh", first(/^(\d+)/, url.params.get("gh_jid"))),
  (url) => prefixed("ashby", uuid(url.params.get("ashby_jid"))),
  (url) =>
    isHost(url.host, "greenhouse.io")
      ? prefixed("gh", first(/\/jobs\/(\d+)/, url.path) ?? first(/^(\d+)/, url.params.get("token")))
      : undefined,
  (url) => {
    const site = GREENHOUSE_SITES.find(([host]) => host === url.host);
    return site && prefixed("gh", first(site[1], url.path));
  },
  (url) => {
    const site = WORKDAY_SITES.find(([host]) => host === url.host);
    return site && prefixed(`wd:${site[2]}`, first(site[1], url.path)?.toUpperCase());
  },
  (url) => (isHost(url.host, "lever.co") ? prefixed("lever", uuid(url.path)) : undefined),
  (url) => (url.host === "jobs.ashbyhq.com" ? prefixed("ashby", uuid(url.path)) : undefined),
  (url) => (isHost(url.host, "rippling.com") ? prefixed("rippling", uuid(url.path)) : undefined),
  workday,
  (url) =>
    isHost(url.host, "icims.com") || url.params.has("icims")
      ? prefixed(`icims:${url.host}`, first(/\/jobs\/(\d+)/, url.path))
      : undefined,
  (url) =>
    isHost(url.host, "smartrecruiters.com")
      ? prefixed("sr", first(/\/(\d{7,})(?:-|\/|$)/, url.path))
      : undefined,
  // Oracle Recruiting Cloud, also behind a custom domain (enterpriseplatform.dell.com).
  (url) => {
    const cloud = isHost(url.host, "oraclecloud.com");
    if (!cloud && !/^\/hcmui\/candidateexperience\//i.test(url.path)) return undefined;
    const id = first(/\/job\/([A-Za-z0-9]+)(?:\/|$)/, url.path)?.toUpperCase();
    return prefixed(`oracle:${cloud ? label(url.host) : url.host}`, id);
  },
  (url) =>
    isHost(url.host, "taleo.net")
      ? prefixed(`taleo:${label(url.host)}`, first(/^([A-Za-z0-9]+)$/, url.params.get("job"))?.toUpperCase())
      : undefined,
  (url) =>
    isHost(url.host, "eightfold.ai")
      ? prefixed(`eightfold:${label(url.host)}`, first(/\/job\/(\d+)/, url.path))
      : undefined,
  (url) =>
    url.host === "careers.ibm.com" ? prefixed("ibm", first(/^(\d+)$/, url.params.get("jobid"))) : undefined,
  avature,
  (url) =>
    isHost(url.host, "careers.microsoft.com") ? prefixed("msft", first(/\/job\/(\d+)/, url.path)) : undefined,
  // Phenom career sites: /global/en/job/JR10261/...
  (url) => {
    const id = first(/^\/(?:global|[a-z]{2})\/[a-z]{2}\/job\/([^/]+)/i, url.path);
    return id === undefined ? undefined : `phenom:${url.host}:${id.toUpperCase()}`;
  },
  // SuccessFactors career sites: /job/<slug>/1423104500/ and /talentcommunity/apply/1423104500
  (url) =>
    prefixed(`sf:${url.host}`, first(/\/(?:job\/[^/]+|talentcommunity\/apply)\/(\d{6,})(?:\/|$)/, url.path)),
  (url) => (url.host === "amazon.jobs" ? prefixed("amazon", first(/\/jobs\/(\d+)/, url.path)) : undefined),
  (url) =>
    ["lifeattiktok.com", "joinbytedance.com", "jobs.bytedance.com", "careers.tiktok.com"].includes(url.host)
      ? prefixed("bytedance", first(/\/(?:search|position)\/(\d+)/, url.path))
      : undefined,
  (url) =>
    url.host === "metacareers.com"
      ? prefixed("meta", first(/\/(?:jobs|job_details)\/(\d+)/, url.path))
      : undefined,
  (url) =>
    url.host === "google.com" ? prefixed("google", first(/^\/about\/careers\/.*\/results\/(\d+)/, url.path)) : undefined,
  (url) => (url.host === "jobs.apple.com" ? prefixed("apple", first(/\/details\/(\d+)/, url.path)) : undefined),
  (url) =>
    url.host === "jobs.jobvite.com" ? prefixed("jobvite", first(/\/job\/([A-Za-z0-9]+)/, url.path)) : undefined,
  (url) =>
    isHost(url.host, "applytojob.com") ? prefixed("jazz", first(/\/apply\/([A-Za-z0-9]+)/, url.path)) : undefined,
  (url) =>
    url.host === "apply.workable.com"
      ? prefixed("workable", first(/\/j\/([A-Za-z0-9]+)/, url.path)?.toUpperCase())
      : undefined,
  (url) =>
    isHost(url.host, "bamboohr.com")
      ? prefixed(`bamboo:${label(url.host)}`, first(/\/careers\/(\d+)/, url.path))
      : undefined,
  (url) => (isHost(url.host, "pinpointhq.com") ? prefixed("pinpoint", uuid(url.path)) : undefined),
  (url) =>
    url.host === "recruiting.paylocity.com"
      ? prefixed("paylocity", first(/\/jobs\/(?:details|apply)\/(\d+)/i, url.path))
      : undefined,
  (url) =>
    isHost(url.host, "breezy.hr")
      ? prefixed(`breezy:${label(url.host)}`, first(/^\/p\/([0-9a-f]{12,})(?:-|\/|$)/, url.path))
      : undefined,
  (url) => (url.host === "higher.gs.com" ? prefixed("gs", first(/\/roles\/(\d+)/, url.path)) : undefined),
  // Both /careers/search/job/<n> and /careers/search/job/<slug>-<n>.
  (url) =>
    url.host === "tesla.com"
      ? prefixed("tesla", first(/\/careers\/search\/job\/(?:[^/]*-)?(\d+)$/, url.path))
      : undefined,
];

const ID_PARAMS = [
  "jobid", "job", "req", "reqid", "jobcode", "id", "opportunityid", "postingid", "requisitionid", "jobreqid", "pid",
];

const NOISE_PARAMS = new Set([
  "ref", "gh_src", "source", "src", "mobile", "needsredirect", "embed", "icims", "ats", "nl", "fr", "oga", "lang",
  "locale", "t", "in_iframe", "iis", "iisn", "codes", "jr_id", "job_board_id", "for", "type", "mode",
]);

/**
 * A job id in a path segment: "12345", "123456-some-title" or "some-title-123456", never part of a
 * UUID or hex token. A slug needs 6+ digits because it often ends in a ZIP code ("…-TX-75219").
 */
function pathId(segments: string[]): string | undefined {
  for (const segment of segments.toReversed()) {
    if (UUID.test(segment) || /^(?=.*[a-f])[0-9a-f]{16,}$/i.test(segment)) continue;
    const id = first(/^(\d{5,})$/, segment) ?? first(/^(\d{6,})-/, segment) ?? first(/[-_](\d{6,})$/, segment);
    if (id !== undefined) return id;
  }
  return undefined;
}

function generic(url: Parts): string {
  for (const name of ID_PARAMS) {
    const value = url.params.get(name);
    if (value) return `url:${url.host}:${value}`;
  }
  const id = pathId(url.segments);
  if (id !== undefined) return `url:${url.host}:${id}`;
  const query = url.query
    .filter(([name]) => !NOISE_PARAMS.has(name.toLowerCase()) && !name.toLowerCase().startsWith("utm_"))
    .map(([name, value]) => `${name.toLowerCase()}=${value}`);
  return `url:${url.host}${url.path.toLowerCase()}${query.length > 0 ? `?${query.join("&")}` : ""}`;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The identity of the job behind an apply URL, derived from the ATS job id where possible. */
export function canonicalKey(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return `raw:${raw.trim().toLowerCase()}`;
  }
  const segments = url.pathname.split("/").filter(Boolean).map(decode);
  const params = new Map<string, string>();
  const pairs = new Map<string, [string, string]>();
  for (const [name, value] of url.searchParams) {
    if (!params.has(name.toLowerCase())) params.set(name.toLowerCase(), value);
    pairs.set(`${name}=${value}`, [name, value]);
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts: Parts = {
    host: HOST_ALIASES.get(host) ?? host,
    segments,
    path: `/${segments.join("/")}`,
    params,
    query: [...pairs.values()].sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y)),
  };
  for (const rule of RULES) {
    const key = rule(parts);
    if (key !== undefined) return key;
  }
  return generic(parts);
}
