import type { SourceName } from "./job.ts";

/**
 * Who can apply: only graduate students (Master's, PhD, MBA), undergraduates (maybe with graduate
 * students too), or not clear. jobbo is for undergraduates, so it holds back graduate-only jobs.
 */
export type Level = "graduate" | "undergraduate" | "unknown";

// "BS/MS", "UG/MS" and "Bachelor's or Master's" let undergraduates apply. The codes are case-sensitive.
const UNDERGRADUATE_TITLE = /\b(undergrad\w*|bachelor\w*)\b/i;
const UNDERGRADUATE_CODE = /\b(B\.?Sc?|UG)\b/;
// "Graduate Intern" is a graduate student in the US, and elsewhere a graduate, who isn't a student
// either. Not "Master Data" (master data management), "Scrum Master", "New Grad", "Intern/Graduate"
// (an intern or a graduate) or "grad 2028" (a graduation year).
const GRADUATE_TITLE =
  /\b(ph\.? ?d|doctora(l|te)|doctor of philosophy|post[- ]?doc\w*|postgrad\w*|mba)\b|(?<!\bscrum[\s-]*)\bmasters?\b(?![\s-]+data\b)|(?<!\b(new|recent|university|college)[\s-]+|\binterns? ?\/ ?)\bgrad(uate)?\b(?![\s-]+'?(20)?\d\d\b)/i;
// Case-sensitive, and not "HDX-MS" (mass spectrometry) or "(TN, LA, OK, MS, AR)" (Mississippi).
const GRADUATE_CODE = /(?<![A-Z]-|\b[A-Z]{2}, )\bM\.?Sc?\b(?!, [A-Z]{2}\b)/;

export function titleLevel(title: string): Level {
  if (UNDERGRADUATE_TITLE.test(title) || UNDERGRADUATE_CODE.test(title)) return "undergraduate";
  if (GRADUATE_TITLE.test(title) || GRADUATE_CODE.test(title)) return "graduate";
  return "unknown";
}

// Simplify's "degrees": ["Bachelor's", "Master's"], ["PhD"], ["MBA"], []. ECR's "studentYears":
// "1st year" to "4th year", "Undergraduate — year not stated", "Graduate student", "New grad", "Not stated".
const LEVEL_FIELDS: Partial<Record<SourceName, string>> = { simplify: "degrees", ecr: "studentYears" };
const GRADUATE_VALUES = new Set(["Master's", "MBA", "PhD", "JD", "MD", "PharmD", "DO", "DDS", "DVM", "Graduate student"]);
const UNSTATED_VALUES = new Set(["Not stated", "New grad"]);

/** What a stored Simplify or ECR record says; speedyapply has only the title. */
export function recordLevel(source: SourceName, raw: string): Level {
  const field = LEVEL_FIELDS[source];
  if (field === undefined) return "unknown";
  const values: unknown = JSON.parse(raw)[field];
  if (!Array.isArray(values)) return "unknown";
  const stated = values.filter((value) => !UNSTATED_VALUES.has(value));
  if (stated.length === 0) return "unknown";
  return stated.every((value) => GRADUATE_VALUES.has(value)) ? "graduate" : "undergraduate";
}

/**
 * True when a job is only for graduate students. When any listing's title names a level, the
 * titles decide, because the sources' own fields are sometimes wrong ("MS/PhD" jobs marked for
 * bachelor's students). Otherwise Simplify's and ECR's fields decide. Either way, one listing that
 * lets undergraduates apply keeps the job, and so does a job where nothing says.
 */
export function isGraduateOnly(listings: { source: SourceName; title: string; raw: string }[]): boolean {
  const titles = listings.map((listing) => titleLevel(listing.title));
  const levels = titles.some((level) => level !== "unknown")
    ? titles
    : listings.map((listing) => recordLevel(listing.source, listing.raw));
  return levels.includes("graduate") && !levels.includes("undergraduate");
}
