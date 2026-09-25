const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

export function cleanText(text: string): string {
  return text.normalize("NFKC").replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim();
}

function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

const COMPANY_SUFFIXES = new Set([
  "inc", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "holdings", "holding",
  "plc", "lp", "llp", "the", "incorporated",
]);

/** For grouping look-alike openings: "Booz Allen Hamilton Inc." → "booz allen hamilton". */
export function normalizeCompany(name: string): string {
  return words(name.replace(/\([^)]*\)/g, " "))
    .filter((word) => !COMPANY_SUFFIXES.has(word))
    .join(" ");
}

export function normalizeTitle(title: string): string {
  return words(title).join(" ");
}
