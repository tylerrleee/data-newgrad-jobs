import type { SourceName } from "./job.ts";

/**
 * Who can apply: only graduate students (Master's, PhD, MBA), only high school students,
 * undergraduates (maybe with others too), or not clear. jobbo is for a bachelor's graduate, so it
 * holds back graduate-only and high-school-only jobs.
 */
export type Level = "graduate" | "high school" | "undergraduate" | "unknown";

// "BS/MS", "UG/MS" and "Bachelor's or Master's" let undergraduates apply. The codes are case-sensitive.
const UNDERGRADUATE_TITLE = /\b(undergrad\w*|bachelor\w*)\b/i;
const UNDERGRADUATE_CODE = /\b(B\.?Sc?|UG)\b/;
// On a new-grad list "Graduate" alone ("Graduate Data Engineer", "Graduate Leadership Program")
// means a new graduate, so only a named graduate degree or a graduate student counts. Not "Master
// Data" (master data management) or "Scrum Master".
const GRADUATE_TITLE =
  /\b(ph\.? ?d|doctora(l|te)|doctor of philosophy|post[- ]?doc\w*|post[- ]?grad\w*|mba|grad(uate)?[\s-]+(students?|level|research|teaching))\b|(?<!\bscrum[\s-]*)\bmasters?\b(?![\s-]+data\b)/i;
// "High School Internship, Software Engineering", "Innovation Developer - High School Student".
// "High School or College Intern" also lets undergraduates apply. Not "HS", which is often another word.
const HIGH_SCHOOL_TITLE = /\b(high[- ]?school|secondary school)\b/i;
const COLLEGE_TITLE = /\b(college|university)\b/i;
// Case-sensitive, and not "HDX-MS" (mass spectrometry) or "(TN, LA, OK, MS, AR)" (Mississippi).
const GRADUATE_CODE = /(?<![A-Z]-|\b[A-Z]{2}, )\bM\.?Sc?\b(?!, [A-Z]{2}\b)/;

export function titleLevel(title: string): Level {
  if (UNDERGRADUATE_TITLE.test(title) || UNDERGRADUATE_CODE.test(title)) return "undergraduate";
  if (HIGH_SCHOOL_TITLE.test(title)) return COLLEGE_TITLE.test(title) ? "undergraduate" : "high school";
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

type LevelListing = { source: SourceName; title: string; raw: string };

/**
 * Each listing's level. When any listing's title names a level, the titles decide, because the
 * sources' own fields are sometimes wrong ("MS/PhD" jobs marked for bachelor's students, a high
 * school internship marked "New grad"). Otherwise Simplify's and ECR's fields decide.
 */
function levels(listings: LevelListing[]): Level[] {
  const titles = listings.map((listing) => titleLevel(listing.title));
  return titles.some((level) => level !== "unknown")
    ? titles
    : listings.map((listing) => recordLevel(listing.source, listing.raw));
}

/**
 * True when a job is only for graduate students. One listing that lets undergraduates apply keeps
 * the job, and so does a job where nothing says.
 */
export function isGraduateOnly(listings: LevelListing[]): boolean {
  const found = levels(listings);
  return found.includes("graduate") && !found.includes("undergraduate");
}

/** True when a job is only for high school students, by the same rules as isGraduateOnly. */
export function isHighSchoolOnly(listings: LevelListing[]): boolean {
  const found = levels(listings);
  return found.includes("high school") && !found.includes("undergraduate") && !found.includes("graduate");
}
