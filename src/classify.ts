const INTERN =
  /\b(interns?|internships?|co-?ops?|apprentices?|apprenticeships?|trainees?|placements?|students?|graduate (research |teaching )?assistant(ship)?s?)\b/i;
const NEW_GRAD =
  /\b(new[ -]?grads?|new[ -]?graduates?|(university|college|recent) grad(uate)?s?|graduates|(university|college|campus) hires?|graduate (program|programme|scheme)|entry[- ]level|full[- ]time|early[- ]careers?)\b|^graduate\b/i;

// Full-time offers for interns converting ("Intern Conversion", "Grad - Conversion"). CVS posts them
// on a Workday site named Private_Postings_Intern_Conversion_ONLY, which Simplify retitles as internships.
const CONVERSION = /\b(intern(ship)?s?|grad(uate)?)\b[\s\-_:–]*(to[\s\-_]+full[\s\-_]*time[\s\-_]*)?conversion\b/i;

/**
 * False for intern-conversion offers, and for titles that say new grad or full time without ever
 * mentioning an internship.
 */
export function isInternship(title: string, url = ""): boolean {
  if (CONVERSION.test(title) || CONVERSION.test(url.replace(/[-_/]+/g, " "))) return false;
  return INTERN.test(title) || !NEW_GRAD.test(title);
}

/** Categories precise enough that any title in them is a software role. */
const CORE_CATEGORIES = new Set([
  // Early Career Radar tracks
  "SWE", "ML & AI", "Data",
  // speedyapply repos
  "swe", "ai",
]);

// Simplify's categories are broad: "Software" includes general IT and engineering roles and
// "AI/ML/Data" includes business analytics, geology and sustainability, so the title must also
// look technical. zshah101's categories are just as broad.
const TECH_TITLE =
  /\b(technolog\w*|tech|it|information (technology|systems?)|applications?|digital|engineer\w*|develop\w*|automation|systems?|architect\w*|coding|programming|compil\w*|comput\w*|network\w*|iot|simulation|robot\w*|autonom\w*)\b/i;
const DATA_TITLE =
  /\b(data|analytics?|statistic\w*|decision scien\w*|model(s|ing|ling)?|researchers?|research (intern|scientist|engineer|assistant)\w*|quant\w*|(artificial|machine|language|computational) intelligence|inference|robot\w*|autonom\w*|algorithm\w*|comput\w*|simulation|databases?)\b/i;
const HINTED_CATEGORIES = new Map([
  ["Software", TECH_TITLE],
  ["Software Engineering", TECH_TITLE],
  ["AI/ML/Data", DATA_TITLE],
  ["Data Science, AI & Machine Learning", DATA_TITLE],
  ["Data & ML/AI", DATA_TITLE],
]);

// "Software-defined radio" is hardware; "platform" alone is mostly TikTok operations and hardware;
// "programming" alone is mostly TV and radio programming. "C++" can't end on a word boundary.
const SOFTWARE_TITLE =
  /\b(software(?![- ]defined)|swe|sde|developer|programmer|devops|sre|site reliability|full[- ]?stack|front[- ]?end|back[- ]?end|web|mobile|ios|android|app(lication)? develop\w*|database (engineer|develop)\w*|python|machine learning|ml|ai|artificial intelligence|deep learning|reinforcement learning|neural networks?|computer vision|perception|nlp|llms?|data scien\w*|data engineer\w*|data analy\w*|research engineer\w*|applied scien\w*|algorithms? engineer\w*|platform engineer\w*|data platforms?|cloud|infrastructure|embedded software|firmware|motion planning|security engineer\w*|cyber[- ]?security|cyber (research|systems?|operations|defense)|information security|infosec|offensive security|security research\w*|penetration test\w*|application security|quant(itative)? developer|computer science)\b|\bc\+\+/i;
// Roles that aren't engineering whatever they work on: "Software Product Management Intern",
// "Project Coordinator Intern - Infrastructure".
// Recruiting only denies the role itself: "Software Engineer Intern - Campus Recruiting" is software.
const NOT_ENGINEERING =
  /\b(sales|recruiters?|recruit(ing|ment) (intern|coordinator|assistant)\w*|talent acquisition|legal|product marketing|product manag\w*|product owner|program manag\w*|project manag\w*|project coordinat\w*)\b/i;
// Other fields, unless a strong software word says otherwise: "Software Engineer Intern - Hardware".
// Transportation, roadway, water and structural engineering catch civil "infrastructure" roles; CNC catches machine-shop "programmer" roles.
const OTHER_FIELD =
  /\b(financ\w*|accounting|audit\w*|tax|marketing|human resources|hr|business (analyst|analytics|intelligence)|investment\w*|investing|banking|equity|wealth|supply chain|procurement|mechanical|civil|structural engineer\w*|transportation|roadway|water|wastewater|chemical|manufacturing|cnc|machining|machinists?|hardware|asic|fpga|analog|rf|pcb|actuar\w*|graphic design\w*|(ui ?\/ ?)?ux( ?\/ ?ui)? (design|research)\w*|product design)\b/i;
const STRONG =
  /\b(software(?![- ]defined)|swe|(?<!\b(hardware|fpga|asic)( and systems)? )developer|app(lication)? develop\w*|machine learning|data scien\w*|data engineer\w*|(ai|artificial intelligence) engineer\w*)\b/i;

export function isSoftware({ category, title }: { category: string | null; title: string }): boolean {
  if (NOT_ENGINEERING.test(title)) return false;
  if (OTHER_FIELD.test(title) && !STRONG.test(title)) return false;
  if (SOFTWARE_TITLE.test(title)) return true;
  if (category === null) return false;
  return CORE_CATEGORIES.has(category) || (HINTED_CATEGORIES.get(category)?.test(title) ?? false);
}
