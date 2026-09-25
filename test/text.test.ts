import { describe, expect, test } from "bun:test";
import { cleanText, normalizeCompany, normalizeTitle } from "../src/text.ts";

describe("cleanText", () => {
  test("applies NFKC", () => {
    expect(cleanText("\uFF21\uFF29 Engineer")).toBe("AI Engineer");
    expect(cleanText("Pro\uFB01le Intern")).toBe("Profile Intern");
    expect(cleanText("Socie\u0301te\u0301")).toBe("Soci\u00E9t\u00E9");
  });

  test("strips zero-width characters", () => {
    expect(cleanText("Soft\u200Bware")).toBe("Software");
    expect(cleanText("\uFEFFData\u200C\u200D\u2060 Intern")).toBe("Data Intern");
  });

  test("collapses and trims whitespace", () => {
    expect(cleanText("  Software\u00A0 Engineer\n\tIntern  ")).toBe("Software Engineer Intern");
    expect(cleanText("\u200B")).toBe("");
  });

  test("leaves & and | alone", () => {
    expect(cleanText("R&D | Platform")).toBe("R&D | Platform");
  });
});

describe("normalizeCompany", () => {
  test("drops legal suffixes, articles and parentheses", () => {
    expect(normalizeCompany("Booz Allen Hamilton Inc.")).toBe("booz allen hamilton");
    expect(normalizeCompany("Booz Allen Hamilton")).toBe("booz allen hamilton");
    expect(normalizeCompany("The Boeing Company")).toBe("boeing");
    expect(normalizeCompany("Jane Street Capital, LLC")).toBe("jane street capital");
    expect(normalizeCompany("Hewlett Packard (HP)")).toBe("hewlett packard");
  });

  test("spells out & and strips accents", () => {
    expect(normalizeCompany("AT&T")).toBe("at and t");
    expect(normalizeCompany("Société Générale (SG)")).toBe("societe generale");
  });

  test("only drops whole suffix words", () => {
    expect(normalizeCompany("Constructor")).toBe("constructor");
    expect(normalizeCompany("Incyte")).toBe("incyte");
    expect(normalizeCompany("Theorem LP")).toBe("theorem");
  });
});

describe("normalizeTitle", () => {
  test("lowercases and keeps only letters and digits", () => {
    expect(normalizeTitle("Software Engineer Intern – Summer 2027 (R&D)")).toBe("software engineer intern summer 2027 r and d");
    expect(normalizeTitle("Ingénieur Logiciel · Stage")).toBe("ingenieur logiciel stage");
    expect(normalizeTitle("Software Engineer, Intern")).toBe(normalizeTitle("software engineer - intern"));
    expect(normalizeTitle("—")).toBe("");
  });
});
