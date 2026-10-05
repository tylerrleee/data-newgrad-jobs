/** Jobs that require at least this many years of experience aren't for new graduates. */
export const HOLD_YEARS = 2;

/** The most years of experience a posting requires, and the sentence that says so. */
export interface Requirement {
  years: number;
  evidence: string;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const NUMBER = String.raw`(\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})`;
// "3+ years", "two (2) years", "2-4 yrs", "5 to 7 years", "three or more years", "two-plus years".
const YEARS = new RegExp(
  String.raw`\b${NUMBER}(?:\s*\(\d{1,2}\+?\))?(?:\s*\+|\s*-?\s*plus)?` +
    String.raw`(?:\s*(?:-|–|—|to)\s*${NUMBER}(?:\s*\(\d{1,2}\))?\s*\+?)?(?:\s+or\s+more)?\s*(?:years?|yrs?)\b`,
  "gi",
);
// A posting about to join a company "with over 50 years of experience" isn't asking for 50.
const MAX_YEARS = 15;

// Not a minimum: "less than 2 years", "within the last 3 years", "after two years".
const NOT_MINIMUM_BEFORE =
  /\b(less than|fewer than|under|up to|no more than|maximum of|max\.?|last|past|within|every|after|next|first)\s*$/i;
// Not experience: "4 years of college", "18 years old", and the length of a program: "a 2 year
// rotational program", "a 1 year targeted, fast-track programme".
const NOT_EXPERIENCE_AFTER =
  /^\s*(old|of age|ago|later|of (college|university|school|study|studies|coursework|undergraduate|graduate|post-?secondary|education|age)|(bachelor|undergraduate|college|university|degree|contract|commitment|term|period|warranty|history))\b|^\s*((?!of\b|in\b|experience\b)[\w,-]+\s+){0,3}(program|programme|rotation|rotational|scheme|assignment)\b/i;
const EXPERIENCE = /\bexperience[ds]?\b|\bwork history\b/i;
// "3+ years in a data engineering role", "2+ years in product analysis", "2 years of professional SQL".
const EXPERIENCE_AFTER =
  /^\s*(of\s+)?(professional|relevant|industry|related|hands-on|full-time|work|working)\b|^\s*in\s+(?!(the|a)\s+(row|last|past)\b|business\b|operation\b)/i;
// "2+ years of experience, preferably with fintech clients": the preference is only the detail.
const PREFERRED_DETAIL = /\b(preferabl[ey]|ideally)\s+(in|with|within|including|for|at|from)\b[^,;]*/gi;
// "a plus", "preferred", "ideally": not a requirement.
const PREFERRED =
  /\b(prefer(red|ably)?|nice[- ]to[- ]have|a plus|bonus|ideal(ly)?|desired|desirable|advantageous|good to have)\b/i;
// "2+ years of experience, including internships": a new graduate may have that.
const STUDENT_EXPERIENCE =
  /(?<!\b(excluding|not including|outside( of)?|beyond|post|after)\s+(\w+\s+)?)\b(intern(ship)?s?|co-?ops?|academic|coursework|research projects?|personal projects?)\b/i;
const PREFERRED_HEADING = /\b(prefer\w*|nice|bonus|plus(es)?|desired|ideal\w*|stand out|extra|good to have)\b/i;
const ITEM = /^[-•*·▪●◦]\s*/;

function number(text: string): number {
  return NUMBER_WORDS[text.toLowerCase()] ?? Number(text);
}

const HAS_YEARS = new RegExp(YEARS.source, "i");

/** "Preferred Qualifications:", "What you'll bring": a short line that isn't a list item or a sentence. */
function isHeading(line: string): boolean {
  return !ITEM.test(line) && line.length <= 60 && !/[.!?]$/.test(line) && !HAS_YEARS.test(line);
}

/** The years a sentence requires, or undefined when it doesn't require any. */
function sentenceYears(text: string): number | undefined {
  const sentence = text.replace(PREFERRED_DETAIL, "");
  if (PREFERRED.test(sentence) || STUDENT_EXPERIENCE.test(sentence)) return undefined;
  let most: number | undefined;
  for (const match of sentence.matchAll(YEARS)) {
    const before = sentence.slice(0, match.index);
    const after = sentence.slice(match.index + match[0].length);
    if (NOT_MINIMUM_BEFORE.test(before) || NOT_EXPERIENCE_AFTER.test(after)) continue;
    if (!EXPERIENCE.test(sentence) && !EXPERIENCE_AFTER.test(after)) continue;
    // A range asks for its lower end: "2-4 years" lets someone with 2 apply.
    const years = number(match[1]!);
    if (years > MAX_YEARS) continue;
    most = Math.max(most ?? 0, years);
  }
  return most;
}

/**
 * The most years of experience a posting requires, read from its text. Sentences under a
 * "Preferred"/"Nice to have" heading, or that say so themselves, don't count, and neither do
 * requirements that internships or school can meet. Several requirements all apply, so the
 * largest wins; with "BS + 3 years or MS + 1 year", that is the bachelor's graduate's.
 */
export function requiredYears(text: string): Requirement | undefined {
  let found: Requirement | undefined;
  let preferred = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeading(line)) {
      preferred = PREFERRED_HEADING.test(line);
      continue;
    }
    if (preferred) continue;
    for (const sentence of line.replace(ITEM, "").split(/(?<=[.;!?])\s+/)) {
      const years = sentenceYears(sentence);
      if (years !== undefined && (found === undefined || years > found.years)) {
        found = { years, evidence: sentence.trim() };
      }
    }
  }
  return found;
}

/** The requirement that keeps a new graduate out, if the posting has one. */
export function needsExperience(text: string): Requirement | undefined {
  const requirement = requiredYears(text);
  return requirement !== undefined && requirement.years >= HOLD_YEARS ? requirement : undefined;
}
