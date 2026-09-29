import { describe, expect, test } from "bun:test";
import { isGraduateOnly, recordLevel, titleLevel, type Level } from "../src/degree.ts";
import type { SourceName } from "../src/job.ts";

function expectTitles(titles: string[], level: Level) {
  for (const title of titles) {
    expect([title, titleLevel(title)]).toEqual([title, level]);
  }
}

describe("titleLevel", () => {
  test("graduate degrees and graduate students", () => {
    expectTitles(
      [
        "Summer 2027 PhD AI Engineering Intern",
        "Generative AI Ph.D. Research Intern",
        "2027 Summer Intern, MS/PhD, Software Engineer",
        "Software Engineer Intern - MS",
        "2027 Summer Intern, MS, Software Engineering, Behavior Test",
        "Data Science Intern - Magnet Program - Online MS Analytics",
        "MSc Intern",
        "Machine Learning Intern (Masters) - Summer 2027",
        "Master's Data Science Internship",
        "AI Tools Master%27s Intern",
        "Data Analytics Master Intern",
        "Machine Learning Engineer Intern - Master of Science/Doctor of Philosophy",
        "AI Solutions & Value MBA Intern",
        "Postdoctoral Researcher Intern - Foundational AI: Theory and Architectures",
        "Post Grad Data Science Intern",
        "Graduate Intern - Artificial Intelligence & Data Science - Summer 2027",
        "Grad Intern - Software Engineer - Amgen’s Technology & Medical Organizations - Summer 2027",
        "Software Engineering Graduate Student Intern",
        "Summer 2027 Software Developer Internship - Graduate",
        "Data Engineering Intern – Graduate Level",
        "Graduate Research Assistant",
      ],
      "graduate",
    );
  });

  test("any undergraduate marker lets undergraduates apply", () => {
    expectTitles(
      [
        "Undergrad Intern - Software Engineer - Amgen’s Technology & Medical Organizations - Summer 2027",
        "Software Engineering Undergraduate Internship",
        "Software Development Bachelor's Intern",
        "Software Engineer Intern - BS/MS",
        "Software Engineering Intern, BS, Summer 2027",
        "Campus Quantitative Researcher - UG/MS - Intern",
        "Quantitative Researcher Intern - Bachelor's or Master's",
        "MSc or BSc Thesis / Internship - m/f/d AI for Intent-Based Networking",
        "Research Intern - BS/MS/PhD",
        "Summer 2026 Quantum Software Internship – Undergraduate/Graduate",
      ],
      "undergraduate",
    );
  });

  test("words that look like degrees but aren't", () => {
    expectTitles(
      [
        "Software Engineer Intern",
        "Master Data Intern",
        "Global Supply Chain Master Data & Analytics Intern",
        "Agile Scrum Master Intern",
        "Mastercard Software Engineer Intern",
        "Intern for Computational Structure Analysis Using MD - AI/ML with HDX-MS",
        "Area Manager Intern – Summer 2027 (TN, LA, OK, MS, AR)",
        "Software Engineer Intern, Defense Tech (Summer 2027, grad 2028)",
        "New Grad Olympics Intern - Software Engineer",
        "Data Science Intern/Graduate - NZ",
        "Software Engineer Intern - Interns/Graduates",
        "Summer 2027 Intern (Graduating 2028)",
      ],
      "unknown",
    );
  });
});

describe("recordLevel", () => {
  const simplify = (degrees: unknown) => recordLevel("simplify", JSON.stringify({ degrees }));
  const ecr = (studentYears: unknown) => recordLevel("ecr", JSON.stringify({ studentYears }));

  test("Simplify's degrees", () => {
    expect(simplify(["PhD"])).toBe("graduate");
    expect(simplify(["Master's", "PhD"])).toBe("graduate");
    expect(simplify(["Master's", "MBA"])).toBe("graduate");
    expect(simplify(["Bachelor's", "Master's", "PhD"])).toBe("undergraduate");
    expect(simplify(["Associate's"])).toBe("undergraduate");
    expect(simplify([])).toBe("unknown");
    expect(simplify(undefined)).toBe("unknown");
  });

  test("ECR's student years", () => {
    expect(ecr(["Graduate student"])).toBe("graduate");
    expect(ecr(["Graduate student", "New grad"])).toBe("graduate");
    expect(ecr(["3rd year", "Graduate student"])).toBe("undergraduate");
    expect(ecr(["Undergraduate — year not stated", "Graduate student"])).toBe("undergraduate");
    expect(ecr(["Not stated"])).toBe("unknown");
    expect(ecr(["New grad"])).toBe("unknown");
  });

  test("speedyapply rows have no level", () => {
    expect(recordLevel("speedyapply", "| Acme | PhD Intern | NYC | … |")).toBe("unknown");
  });
});

describe("isGraduateOnly", () => {
  const at = (source: SourceName, title: string, record: object = {}) => ({
    source,
    title,
    raw: source === "speedyapply" ? `| Acme | ${title} |` : JSON.stringify(record),
  });

  test("a graduate title or record, with nothing for undergraduates, is graduate-only", () => {
    expect(isGraduateOnly([at("speedyapply", "Software Engineer Intern - MS/PhD")])).toBe(true);
    expect(isGraduateOnly([at("simplify", "Software Engineer Intern", { degrees: ["Master's", "PhD"] })])).toBe(true);
    expect(
      isGraduateOnly([
        at("ecr", "Data Science Intern", { studentYears: ["Graduate student"] }),
        at("simplify", "Data Science Intern", { degrees: [] }),
      ]),
    ).toBe(true);
  });

  test("any listing open to undergraduates keeps the job", () => {
    expect(
      isGraduateOnly([
        at("ecr", "Data Science Intern", { studentYears: ["Graduate student"] }),
        at("simplify", "Data Science Intern", { degrees: ["Bachelor's", "Master's"] }),
      ]),
    ).toBe(false);
    expect(
      isGraduateOnly([
        at("ecr", "Data Analyst Intern- Bachelor's/Master's", { studentYears: ["Graduate student"] }),
        at("simplify", "Data Analyst Intern", { degrees: ["Master's"] }),
      ]),
    ).toBe(false);
  });

  test("a title that names a level outranks the records", () => {
    expect(
      isGraduateOnly([
        at("ecr", "2027 Summer Intern, MS/PhD, Software Engineer", { studentYears: ["Not stated"] }),
        at("simplify", "Software Engineer Intern", { degrees: ["Bachelor's", "Master's", "PhD"] }),
      ]),
    ).toBe(true);
  });

  test("a job where nothing says is not graduate-only", () => {
    expect(isGraduateOnly([at("speedyapply", "Software Engineer Intern")])).toBe(false);
    expect(isGraduateOnly([at("ecr", "Software Engineer Intern", { studentYears: ["Not stated"] })])).toBe(false);
    expect(isGraduateOnly([])).toBe(false);
  });
});
