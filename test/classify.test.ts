import { describe, expect, test } from "bun:test";
import { isDataRole, isEntryLevel } from "../src/classify.ts";

/** [category, title]; the title is in the result so a failure names it. */
type Case = [string | null, string];

function expectDataRole(cases: Case[], dataRole: boolean) {
  for (const [category, title] of cases) {
    expect({ category, title, dataRole: isDataRole({ category, title }) }).toEqual({ category, title, dataRole });
  }
}

function expectEntryLevel(titles: string[], entryLevel: boolean) {
  for (const title of titles) {
    expect({ title, entryLevel: isEntryLevel(title) }).toEqual({ title, entryLevel });
  }
}

describe("isEntryLevel", () => {
  test("keeps new-grad, junior, associate and level-1 titles", () => {
    expectEntryLevel(
      [
        "Data Scientist 1",
        "Data Scientist I - Risk",
        "Associate Data Engineer",
        "Junior Data Analyst",
        "Data Scientist New Grad",
        "2027 University Graduate - Data Engineer",
        "Graduate Data Engineer",
        "Graduate Leadership Program - Data Analytics",
        "Entry Level Business Intelligence Analyst",
        "Data Analyst",
        "Internal Audit Data Analyst",
        "Leadership Development Program - Data",
        "Data Engineer (2027 Start)",
        "Data Engineer - Summer 2027 Start",
        "Data Analyst - New Grad (Summer 2027)",
        "Student Loan Data Analyst",
        "Quantitative Researcher - 2026-2027 Graduates",
      ],
      true,
    );
  });

  test("drops internships and other student jobs", () => {
    expectEntryLevel(
      [
        "Data Science Intern",
        "Data Engineering Internship - Summer 2027",
        "Data Analyst Co-op (Spring 2027)",
        "Working Student Data Analytics",
        "Student Statistician",
        "Working in Technology - WiT Data Science - Summer 2027",
        "Data Science Placement Year",
        "Quantitative Trading Summer Analyst",
        "Graduate Research Assistant - Data",
      ],
      false,
    );
  });

  test("drops roles above entry level", () => {
    expectEntryLevel(
      [
        "Senior Data Scientist",
        "Sr. Data Engineer",
        "Senior Associate, Data Analytics",
        "Senior Analyst - Data & Analytics - Enterprise Technology Services",
        "Staff Data Engineer",
        "Principal Data Scientist",
        "Lead Data Analyst",
        "Analytics Manager",
        "Managing Engineer, Data Engineering",
        "Data Scientist Journeyman",
        "Director, Data Science",
        "Data Engineer II",
        "Data Scientist III - Ads",
        "Data Scientist 2 - Marketplace",
        "Data Analyst, Level 3",
      ],
      false,
    );
  });

  test("drops titles that only name a year before 2027", () => {
    expectEntryLevel(["2026 New Grad - Data Analyst", "Data Scientist - New Grad 2026", "Class of 2025 Analyst"], false);
  });

  test("full-time offers for converting interns aren't open to new applicants", () => {
    expect(isEntryLevel("Data Scientist Intern - Grad Conversion")).toBe(false);
    expect(isEntryLevel("Data Analyst - Grad Conversion")).toBe(false);
    expect(
      isEntryLevel(
        "Software Engineer - Analytics & Behavior Change",
        "https://cvshealth.wd1.myworkdayjobs.com/Private_Postings_Intern_Conversion_ONLY/job/NY---New-York/Software-Engineer---Grad-Intern-Conversion_R1055183",
      ),
    ).toBe(false);
    expect(isEntryLevel("Data Conversion Analyst")).toBe(true);
  });
});

describe("isDataRole", () => {
  test("data science, analysis and engineering titles count", () => {
    expectDataRole(
      [
        ["AI/ML/Data", "Data Scientist"],
        ["AI/ML/Data", "Data Scientist Analyst - Generative AI - Data Science"],
        ["AI/ML/Data", "Associate Data Scientist - Decision Analytics"],
        ["AI/ML/Data", "Data Analyst"],
        ["AI/ML/Data", "Business Data Analyst"],
        ["AI/ML/Data", "Data Engineer 1"],
        ["Software", "Junior Data Engineer"],
        ["AI/ML/Data", "Early Careers Analyst - Data Office: Data Engineering"],
        ["AI/ML/Data", "Data Office Analyst"],
        ["AI/ML/Data", "Data Architect"],
        ["Software", "Multi-Cloud CDN Data Platform Engineer Graduate - CDN Platform"],
        ["Software", "ETL Developer"],
        ["AI/ML/Data", "Data Governance Analyst"],
        ["AI/ML/Data", "Data Quality Analyst"],
        [null, "Statistician"],
        [null, "Statistical Programmer"],
        ["Sales", "Sales Data Analyst"],
        ["Software", "Junior Database Developer"],
        ["AI/ML/Data", "Analytic Developer"],
      ],
      true,
    );
  });

  test("analytics, BI, product, marketing science and operations research count", () => {
    expectDataRole(
      [
        ["AI/ML/Data", "Analytics Engineer"],
        ["AI/ML/Data", "Business Intelligence Analyst"],
        ["AI/ML/Data", "Data Office: Business Intelligence Analyst"],
        ["Software", "Business Intelligence Developer"],
        ["Software", "BI Engineer"],
        ["Product", "Product Analyst"],
        ["AI/ML/Data", "Data & Analytics Analyst - Enterprise Technology Services"],
        ["AI/ML/Data", "Business Analytics Analyst"],
        ["AI/ML/Data", "Insights Analyst"],
        ["AI/ML/Data", "Marketing Science Analyst"],
        ["AI/ML/Data", "Graduate Marketing Scientist"],
        ["AI/ML/Data", "Marketing Analytics Associate"],
        ["AI/ML/Data", "Decision Scientist"],
        ["AI/ML/Data", "Operations Research Analyst"],
      ],
      true,
    );
  });

  test("quant roles count", () => {
    expectDataRole(
      [
        ["Quant", "Quantitative Researcher"],
        ["Quant", "Quant Trader"],
        ["Quant", "Quantitative Developer"],
        ["AI/ML/Data", "Quantitative Financial Analyst 1"],
        ["Quant", "Trading Analyst"],
        ["Quant", "Research Analyst - Systematic Equities"],
        [null, "Quantitative Strategist"],
      ],
      true,
    );
    expectDataRole(
      [
        [null, "Trading Analyst"],
        ["Software", "Quantum Computing Engineer"],
        ["Quant", "Trade Support Associate"],
      ],
      false,
    );
  });

  test("software and ML engineering roles don't count", () => {
    expectDataRole(
      [
        ["Software", "Software Engineer"],
        ["swe", "Backend Engineer - New Grad"],
        ["ML & AI", "Machine Learning Engineer"],
        ["AI/ML/Data", "Research Scientist - Fundamental Generative AI"],
        ["Software", "Site Reliability Engineer"],
        ["AI/ML/Data", "Gen AI Engineering Analyst"],
      ],
      false,
    );
  });

  test("data gig work doesn't count", () => {
    expectDataRole(
      [
        ["AI/ML/Data", "AI/ML Data Contributor - Data Labeling - Content Evaluation"],
        ["AI/ML/Data", "Data Collection Operator - Optimus"],
        ["AI/ML/Data", "Robotics AI Data Collection Operator"],
        ["AI/ML/Data", "Data Collector"],
        ["AI/ML/Data", "Data Labeler"],
        ["AI/ML/Data", "Data Capture Technician - AI & Construction"],
        ["Other", "Data Entry Specialist"],
        ["Hardware", "Data Center Technician"],
      ],
      false,
    );
  });

  test("generic business, finance and operations analysts don't count", () => {
    expectDataRole(
      [
        ["Product", "Business Analyst"],
        ["Product", "Entry Level Business Analyst"],
        ["Operations", "Operations Analyst"],
        ["Finance", "Financial Analyst"],
        ["AI/ML/Data", "Revenue Analytics Associate"],
        ["AI/ML/Data", "Supply Chain Analytics Associate"],
        ["AI/ML/Data", "Geospatial Analyst"],
        ["Other", "Master Data Management Parts Specialist"],
      ],
      false,
    );
  });

  test("a strong data word beats another field", () => {
    expectDataRole(
      [
        ["Finance", "Financial Data Analyst"],
        ["AI/ML/Data", "Supply Chain Data Analyst"],
        ["AI/ML/Data", "HR Data Analyst"],
        ["Finance", "Investment Data Scientist"],
        ["Finance", "Quantitative Financial Analyst"],
      ],
      true,
    );
  });

  test("some roles aren't data work even when the title says data", () => {
    expectDataRole(
      [
        ["AI/ML/Data", "Data Product Manager"],
        ["Product", "Data Science Program Manager"],
        ["Sales", "Analytics Sales Associate"],
        ["Marketing", "Product Marketing - Data Platform"],
      ],
      false,
    );
    expectDataRole([["AI/ML/Data", "Data Analyst - Campus Recruiting"]], true);
  });

  test("ignores case", () => {
    expectDataRole([[null, "DATA SCIENTIST"], [null, "data engineer"]], true);
    expectDataRole([[null, "SOFTWARE ENGINEER"]], false);
  });
});
