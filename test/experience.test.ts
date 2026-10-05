import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { needsExperience, requiredYears } from "../src/experience.ts";

const years = (text: string) => requiredYears(text)?.years;

describe("requiredYears", () => {
  test("reads the common ways of asking for years", () => {
    expect(years("- 3+ years of experience with SQL")).toBe(3);
    expect(years("Minimum of two (2) years of professional experience.")).toBe(2);
    expect(years("At least 5 yrs experience in analytics")).toBe(5);
    expect(years("Three or more years of experience building pipelines.")).toBe(3);
    expect(years("Two-plus years of experience in data science.")).toBe(2);
    expect(years("Experience: 4 years")).toBe(4);
  });

  test("a range asks for its lower end", () => {
    expect(years("0-2 years of experience in a data role")).toBe(0);
    expect(years("1–3 years of experience with Python")).toBe(1);
    expect(years("2 to 4 years of relevant experience")).toBe(2);
  });

  test("counts years in a role without the word experience", () => {
    expect(years("- 3+ years in a data engineering role")).toBe(3);
    expect(years("- 2 years of professional SQL development")).toBe(2);
    expect(years("Typically 2+ years in product analysis, operations, or a related field;")).toBe(2);
    expect(years("Ranked first for 3 years in a row.")).toBeUndefined();
  });

  test("the largest requirement wins, which is the bachelor's graduate's", () => {
    expect(years("- 1+ year of Tableau experience\n- 4+ years of experience with Python")).toBe(4);
    expect(years("BS with 3+ years of experience, or MS with 1+ year of experience.")).toBe(3);
  });

  test("ignores preferred sections and preferred sentences", () => {
    const text = [
      "Basic Qualifications",
      "- Bachelor's degree in Statistics",
      "- 1+ year of experience with SQL",
      "Preferred Qualifications",
      "- 3+ years of experience in analytics",
      "- Tableau",
    ].join("\n");
    expect(years(text)).toBe(1);
    expect(years("5+ years of experience is a plus.")).toBeUndefined();
    expect(years("Ideally 3 years of experience in finance.")).toBeUndefined();
    expect(years("2+ years of recruiting experience, preferably with intern and early career pools")).toBe(2);
    expect(years("Nice to have\n- 4 years of experience with Spark")).toBeUndefined();
  });

  test("a heading after a preferred section ends it", () => {
    expect(years("Nice to have\n- Spark\nWhat you need\n- 3+ years of experience with dbt")).toBe(3);
  });

  test("ignores experience a student can have", () => {
    expect(years("2+ years of experience with Python, including internships.")).toBeUndefined();
    expect(years("2+ years of academic or professional experience in statistics.")).toBeUndefined();
    expect(years("3+ years of industry experience (excluding internships).")).toBe(3);
  });

  test("ignores years that aren't experience", () => {
    expect(years("Bachelor's degree from a 4 year college or university.")).toBeUndefined();
    expect(years("A 2-year rotational program with experience across teams.")).toBeUndefined();
    expect(years("Two year rotation program; gain experience in every team.")).toBeUndefined();
    expect(years("Join a 2 year targeted, fast-track programme to gain experience.")).toBeUndefined();
    expect(years("3 years of program management experience.")).toBe(3);
    expect(years("Must be at least 18 years old.")).toBeUndefined();
    expect(years("Experience with tools released in the last 3 years.")).toBeUndefined();
    expect(years("Less than 2 years of professional experience.")).toBeUndefined();
    expect(years("A company with over 100 years of experience serving clients.")).toBeUndefined();
    expect(years("Benefits vest after two years.")).toBeUndefined();
  });

  test("returns the sentence that asks", () => {
    expect(requiredYears("About us\nWe build things.\nRequirements\n- 3+ years of experience with SQL. Python.")).toEqual({
      years: 3,
      evidence: "3+ years of experience with SQL.",
    });
  });
});

describe("real postings", () => {
  // Data roles from the feeds on 2026-10-05, cut to the headings and lines that mention years.
  // "hold" was checked by hand against each posting's requirements.
  const postings: { company: string; title: string; hold: boolean; text: string }[] = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures/experience-postings.json"), "utf8"),
  );

  test.each(postings.map((posting) => [`${posting.company} · ${posting.title}`, posting] as const))(
    "%s",
    (_name, posting) => {
      expect(needsExperience(posting.text) !== undefined).toBe(posting.hold);
    },
  );
});

describe("needsExperience", () => {
  test("holds back two or more years, not less or none", () => {
    expect(needsExperience("2+ years of experience")?.years).toBe(2);
    expect(needsExperience("1+ year of experience")).toBeUndefined();
    expect(needsExperience("0-2 years of experience")).toBeUndefined();
    expect(needsExperience("New grads welcome!")).toBeUndefined();
  });
});
