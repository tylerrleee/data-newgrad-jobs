// Student jobs, not new-grad ones. "Summer Analyst" is banking's name for an internship.
// Not "Student Loan Data Analyst".
const STUDENT_JOB =
  /\b(interns?|internships?|co-?ops?|students?(?! loans?\b)|placements?|summer (analyst|associate)s?|graduate (research |teaching )?assistant(ship)?s?)\b/i;
// "WiT Data Science - Summer 2027" is a summer program, unless the title says it's a new-grad
// start: "Data Analyst - New Grad (Summer 2027)", "Data Engineer - Summer 2027 Start".
const SUMMER = /\bsummer[\s-]+(20)?\d\d\b(?![\s-]+start)/i;
const NEW_GRAD =
  /\b(new[ -]?grads?|new[ -]?graduates?|(university|college|recent) grad(uate)?s?|graduates?|(university|college|campus) hires?|entry[- ]level|full[- ]time|early[- ]careers?)\b/i;

// Full-time offers for interns converting ("Intern Conversion", "Grad - Conversion"). CVS posts them
// on a Workday site named Private_Postings_Intern_Conversion_ONLY, which Simplify retitles as internships.
const CONVERSION = /\b(intern(ship)?s?|grad(uate)?)\b[\s\-_:–]*(to[\s\-_]+full[\s\-_]*time[\s\-_]*)?conversion\b/i;

// "Senior Associate", "Data Engineer II", "Data Scientist 2 - Ads". Level 1 ("Data Scientist 1",
// "Analyst I"), "Associate" and "Junior" are entry level.
const SENIOR =
  /\b(senior|sr|staff|principal|lead|manager|managing|director|journeyman|head of|vp|vice president)\b|\b(ii|iii|iv|2|3|4)\b(?=\s*($|[-–,(/|]))/i;

// For a May 2027 graduate, a "2026 New Grad" role starts before graduation.
const PAST_YEAR = /\b20(1\d|2[0-6])\b/;
const CURRENT_YEAR = /\b20(2[7-9]|3\d)\b/;

/**
 * False for internships and other student jobs, intern-conversion offers, roles above entry level,
 * and titles that only name a year before 2027. The feeds are new-grad lists, so anything else counts.
 */
export function isEntryLevel(title: string, url = ""): boolean {
  if (CONVERSION.test(title) || CONVERSION.test(url.replace(/[-_/]+/g, " "))) return false;
  if (STUDENT_JOB.test(title) || SENIOR.test(title)) return false;
  if (SUMMER.test(title) && !NEW_GRAD.test(title)) return false;
  return !PAST_YEAR.test(title) || CURRENT_YEAR.test(title);
}

// Data science, analysis and engineering, and quant, whatever else the title says.
// "quant" must end there: not "Quantum".
const STRONG =
  /\b(data scien\w*|data engineer\w*|data analy\w*|analytics engineer\w*|decision scien\w*|marketing (scien\w*|analytics)|quant(s|itative)?|statisticians?|operations research|business intelligence|bi (analyst|developer|engineer)\w*|data (warehous\w*|platform|architect\w*|office|modell?(er|ing)))\b|\betl\b/i;
// Data titles that another field can claim: "Analytics Analyst" yes, "Revenue Analytics" no.
// "Sales Data Analyst" is a data role, "Analytics Sales Associate" isn't.
const WEAK =
  /\b(analytics?|product analysts?|insights? analysts?|reporting analysts?|statistic\w*|database (analyst|developer|engineer)\w*|data\b.*\b(analyst|engineer|scientist|developer)s?)\b/i;
// "Data Labeling", "Data Collection Operator", "AI/ML Data Contributor": gig work, not data roles.
const DATA_GIG =
  /\b(data (label\w*|annotat\w*|collect\w*|capture|entry|contributor|center|centre)|labell?ers?|content evaluat\w*)\b/i;
// Roles that aren't data work whatever they work on: "Data Product Manager".
// Recruiting only denies the role itself: "Data Analyst - Campus Recruiting" is a data role.
const NOT_DATA_ROLE =
  /\b(recruiters?|recruit(ing|ment) (intern|coordinator|assistant)\w*|talent acquisition|legal|product marketing|product manag\w*|product owner|program manag\w*|project manag\w*|project coordinat\w*)\b/i;
const OTHER_FIELD =
  /\b(sales|financ\w*|accounting|audit\w*|tax|marketing|revenue|pricing|human resources|hr|investment\w*|investing|banking|equity|wealth|supply chain|procurement|mechanical|civil|chemical|manufacturing|hardware|actuar\w*)\b/i;
// In a quant category, trading and research roles are quant roles: "Trading Analyst" under "Quant".
const QUANT_CATEGORIES = new Set(["Quant"]);
const QUANT_TITLE = /\b(analysts?|research\w*|traders?|trading|developers?|strateg\w*)\b/i;

export function isDataRole({ category, title }: { category: string | null; title: string }): boolean {
  if (NOT_DATA_ROLE.test(title) || DATA_GIG.test(title)) return false;
  if (STRONG.test(title)) return true;
  if (category !== null && QUANT_CATEGORIES.has(category) && QUANT_TITLE.test(title)) return true;
  return WEAK.test(title) && !OTHER_FIELD.test(title);
}
