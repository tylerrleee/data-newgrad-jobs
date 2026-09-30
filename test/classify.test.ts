import { describe, expect, test } from "bun:test";
import { isInternship, isSoftware } from "../src/classify.ts";

/** [category, title]; the title is in the result so a failure names it. */
type Case = [string | null, string];

function expectSoftware(cases: Case[], software: boolean) {
  for (const [category, title] of cases) {
    expect({ category, title, software: isSoftware({ category, title }) }).toEqual({ category, title, software });
  }
}

function expectInternship(titles: string[], internship: boolean) {
  for (const title of titles) {
    expect({ title, internship: isInternship(title) }).toEqual({ title, internship });
  }
}

describe("isInternship", () => {
  test("keeps explicit internships, even with a new-grad word", () => {
    expectInternship(
      [
        "Software Engineering Co-op (Fall 2026)",
        "Software Engineer Intern",
        "Machine Learning Internship - Summer 2027",
        "Graduate Intern - Artificial Intelligence & Data Science - Summer 2027",
        "Software Engineer Intern - Interns/Graduates",
        "Early Career Software Engineer Intern",
        "Full-Time Software Engineering Internship",
        "Working Student Software Development",
        "Apprentice Software Developer",
        "Software Engineering Placement Year",
        "Technology Trainee - Data",
        "Coop Software Engineer",
      ],
      true,
    );
  });

  test("keeps neutral titles", () => {
    expectInternship(["Software Engineer", "Data Analyst", "Undergraduate Research Assistant", "Praktikum Softwareentwicklung"], true);
  });

  test("drops new-grad and full-time titles without an intern marker", () => {
    expectInternship(
      [
        "2027 University Graduate - Software Engineer",
        "Software Engineer - New Grad Program",
        "Frontend Engineer – New Graduate",
        "New College Grad - IC Package Layout Engineer",
        "Software Engineer - University Hire",
        "2027 Supplier Process Engineer Campus Hire",
        "Engineering Graduate Programme",
        "Entry Level Software Engineer",
        "Full-time Data Scientist",
        "Early Career Software Engineer",
        "Graduate Software Development Engineer",
        "Research Scientist in Vision Foundation Model – Graduates",
      ],
      false,
    );
  });

  test("does not read 'Internal' as an intern marker", () => {
    expectInternship(["Internal Tools Engineer - New Grad", "International Software Engineer - New Grad"], false);
  });
});

describe("isSoftware", () => {
  test("Simplify's broad categories also need a technical title", () => {
    expectSoftware(
      [
        ["AI/ML/Data", "Analytics Intern"],
        ["AI/ML/Data", "Data Governance Analyst Co-op"],
        ["AI/ML/Data", "Robot Learning Intern"],
        ["AI/ML/Data", "Research Intern - Model Shaping"],
        ["AI/ML/Data", "Decision Science Intern"],
        ["Software", "IT Undergraduate Intern"],
        ["Software", "Technology Intern - Summer 2027"],
        ["Software", "Engineering Intern - Distributed Ledger Technology"],
      ],
      true,
    );
    expectSoftware(
      [
        ["AI/ML/Data", "Revenue Management Intern - Summer 2027"],
        ["AI/ML/Data", "Promotions Analyst Intern"],
        ["AI/ML/Data", "Merchandising Analyst Intern"],
        ["AI/ML/Data", "Energy Analyst Intern"],
        ["AI/ML/Data", "Engine Test Intern"],
        ["AI/ML/Data", "Sustainability Intern"],
        ["AI/ML/Data", "Research Analyst Intern - European LNG"],
        ["Software", "Change Management Intern - Spring 2027"],
      ],
      false,
    );
  });

  test("zshah101's data category also needs a data title", () => {
    expectSoftware(
      [
        ["Data & ML/AI", "Data Science/ Data Engineer Intern"],
        ["Data & ML/AI", "Decision Science Intern"],
      ],
      true,
    );
    expectSoftware(
      [
        ["Data & ML/AI", "Sustainability Intern"],
        ["Data & ML/AI", "Co-Op, Bioanalytics"],
      ],
      false,
    );
  });

  test("some roles aren't engineering even when the title says software", () => {
    expectSoftware(
      [
        ["SWE", "Software Product Management Intern"],
        ["Software", "IBM Software Product Marketing Intern"],
        ["swe", "Product Management Intern - Internal Developer Platforms"],
        ["Data", "Technical Program Manager Intern"],
      ],
      false,
    );
  });

  test("core categories count unless denylisted", () => {
    expectSoftware(
      [
        ["SWE", "Summer 2027 Intern"],
        ["ML & AI", "Research Intern"],
        ["Data", "Analytics Intern"],
        ["Software", "Engineering Intern"],
        ["AI/ML/Data", "Quantitative Research Intern"],
        ["Software Engineering", "Technology Intern"],
        ["Data Science, AI & Machine Learning", "Research Assistant"],
        ["swe", "Technology Analyst Intern"],
        ["ai", "Research Intern"],
      ],
      true,
    );
  });

  test("the denylist beats a core category", () => {
    expectSoftware(
      [
        ["ML & AI", "Cloud & AI Finance Intern"],
        ["swe", "Cloud & AI Finance Intern"],
        ["AI/ML/Data", "Business Analytics Intern"],
        ["Data", "Business Intelligence Intern - Summer 2027"],
        ["Data", "Supply Chain Data Analyst Internship 2027"],
        ["Data", "Internal Audit Analytics Intern"],
        ["ML & AI", "Product Design Intern, AI Infrastructure - Summer 2027"],
        ["Software", "University Recruiting Intern"],
        ["Software", "Procurement Intern"],
        ["AI/ML/Data", "HR Data Analyst Intern"],
        ["AI/ML/Data", "Mechanical Engineer Intern"],
        ["AI/ML/Data", "Actuarial Intern - Summer 2027"],
        ["AI/ML/Data", "Tax LLM Associate"],
        ["swe", "Software Defined Radio Hardware Intern - Summer 2027"],
        ["swe", "2027 Shanghai FPGA Developer Summer Internship"],
        ["swe", "Tencent Cloud CPaaS Product Management Intern"],
        ["SWE", "UX Design Intern"],
      ],
      false,
    );
  });

  test("a strong word overrides the denylist", () => {
    expectSoftware(
      [
        ["Finance", "Software Development Intern - Wealth Management Technology"],
        ["Data", "Summer 2027 Internship Program - Marketing Data Science Intern"],
        ["ML & AI", "Machine Learning Engineer Intern (E-Commerce Supply Chain & Logistics-LLM/Agent)"],
        ["AI/ML/Data", "Financial Data Engineer Intern - Summer 2026"],
        ["Data", "Business Intelligence Developer Internship"],
        ["Hardware", "Summer 2027 PhD Applied AI Engineering Intern, Hardware AI"],
        ["SWE", "Software Developer Intern - HR&D"],
        ["SWE", "Front-End Engineer - UX/UI"],
        ["SWE", "Software Engineer Intern - Campus Recruiting"],
      ],
      true,
    );
  });

  test("other categories count only through the title", () => {
    expectSoftware(
      [
        ["Hardware", "Embedded Software Intern - Summer 2027"],
        ["Hardware", "Firmware Engineer Intern"],
        ["Quant", "Quantitative Developer Intern"],
        ["Quant", "Quant Developer Intern"],
        ["Security", "Security Engineer Internship – 2027 (US)"],
        ["Security", "Cybersecurity Intern"],
        ["Other", "Applied Scientist Intern"],
        ["Other", "Computer Science Internship Summer 2027"],
        ["Other", "Engine Programmer Intern"],
        ["Other", "Mobile Applications Intern - iOS"],
        ["Other Engineering", "Platform Engineering Intern"],
        ["Other Engineering", "Summer 2027 SRE - Observability Engineering Internship"],
        ["Customer Success", "Data Science Intern (Customer Success)"],
        [null, "Backend Engineering Intern"],
      ],
      true,
    );
    expectSoftware(
      [
        ["Quant", "Quantitative Trader Intern"],
        ["Quant", "Quantitative Research Intern"],
        ["Hardware", "Mechanical Engineer Intern"],
        ["Hardware", "Digital IC Design Intern"],
        ["PM", "Product Management Intern"],
        ["Operations", "Platform Operations Intern"],
        ["Finance", "Investment Banking Summer Analyst"],
        ["Other", "General Internship Application 2027"],
        [null, "Summer Intern"],
      ],
      false,
    );
  });

  test("the hardware exceptions to 'software' and 'developer'", () => {
    expectSoftware(
      [
        ["Hardware", "Software-Defined Radio Intern"],
        ["Other", "FPGA Developer Intern"],
        ["Other", "Hardware and Systems Developer Intern"],
      ],
      false,
    );
    expectSoftware([["Hardware", "Hardware and Software Engineering Intern"]], true);
  });

  test("ignores case", () => {
    expectSoftware([["Other", "EMBEDDED SOFTWARE INTERN"], ["Other", "machine learning intern"]], true);
    expectSoftware([["SWE", "FINANCE INTERN"]], false);
  });
});

describe("isInternship: intern conversions", () => {
  test("full-time offers for converting interns aren't internships", () => {
    expect(isInternship("Data Scientist Intern - Grad Conversion")).toBe(false);
    expect(isInternship("2026 Intern Conversion: 2027 FT Software Engineer II")).toBe(false);
    expect(
      isInternship(
        "Software Engineer Intern - Analytics & Behavior Change",
        "https://cvshealth.wd1.myworkdayjobs.com/Private_Postings_Intern_Conversion_ONLY/job/NY---New-York/Software-Engineer---Grad-Intern-Conversion_R1055183",
      ),
    ).toBe(false);
    expect(isInternship("Power Conversion Intern")).toBe(true);
    expect(isInternship("Database Conversion Programming Intern")).toBe(true);
  });

  test("graduate assistantships are student jobs", () => {
    expect(isInternship("Graduate Research Assistant - Data")).toBe(true);
  });
});

describe("isSoftware: fixes from the review", () => {
  test("security roles count", () => {
    expectSoftware(
      [
        ["Security", "Information Security Intern"],
        ["Security", "Cyber-Security Internship"],
        ["Security", "Offensive Security Intern (Summer 2027)"],
        ["Security", "Security Research Internship"],
        ["Security", "Summer 2027 Cyber Research Intern"],
      ],
      true,
    );
  });

  test("programming and compilers count only in Simplify's Software category", () => {
    expectSoftware([["Software", "Java Programming Intern"], ["Software", "Quantum Compiler Intern"]], true);
    expectSoftware([["Product", "Programming Intern"]], false);
  });

  test("AI/ML/Data needs a data word, not just 'optimization' or 'intelligence'", () => {
    expectSoftware([["AI/ML/Data", "PhD Intern - Language Intelligence"]], true);
    expectSoftware(
      [
        ["AI/ML/Data", "Business Process Optimization Intern"],
        ["AI/ML/Data", "Competitive Intelligence Intern"],
      ],
      false,
    );
  });
});

describe("isSoftware: fixes from the snapshot audit", () => {
  test("'programming' alone is TV or welding, not software", () => {
    expectSoftware(
      [
        ["Product", "ESPN Programming Intern"],
        ["Product", "Programming Intern"],
        ["Robotics", "Robotic Programming/Welding Intern (Summer 2027)"],
      ],
      false,
    );
  });

  test("CNC programmers and machinists work in a machine shop", () => {
    expectSoftware(
      [
        ["Other Internships", "Lynn CNC Programmer Co-Op"],
        ["Software", "CNC Programming Intern"],
        [null, "Machinist Apprentice"],
      ],
      false,
    );
    expectSoftware([["Other", "Gameplay Programmer Intern"]], true);
  });

  test("application development, databases and languages are software", () => {
    expectSoftware(
      [
        ["Other", "Application Development Intern - Summer 2027"],
        ["Other", "College to Corporate Internship - Application Development (PA)"],
        ["Product", "Application Development-Summer Intern"],
        ["ML & AI", "AI Application Development Engineer Intern (Corporate Service System - Procurement) - 2027 Start"],
        ["Other Engineering", "Database Engineer Intern"],
        ["Other Engineering", "Database Engineering Intern"],
        ["Other", "Python Intern - Summer 2027"],
        ["Quant", "Quantitative Technologist C++ Intern"],
        ["Quant", "Quantitative Technologist Intern, C++"],
      ],
      true,
    );
    expectSoftware([["Other", "Database Coordinator Volunteer/Intern"]], false);
  });

  test("perception, reinforcement learning and neural networks are ML", () => {
    expectSoftware(
      [
        ["Robotics", "Robotics Perception Engineer Intern"],
        ["Other", "Intern- Robot Perception"],
        ["Robotics", "Research Intern - Reinforcement Learning - Robotics"],
        ["Other", "Undergraduate Intern Technical (OpenVINO, Neural Network Compression Tools)"],
      ],
      true,
    );
  });

  test("civil infrastructure is not software infrastructure", () => {
    expectSoftware(
      [
        ["Other Engineering", "Water Infrastructure Engineering Intern - Summer 2027"],
        ["Other", "Transportation Planning Intern- Infrastructure (Summer 2027)"],
        ["Design", "Roadway Design Intern - Infrastructure (Summer 2027)"],
        ["Operations", "Transportation Management Intern, AWS Cloud Logistics"],
        ["AI/ML/Data", "Transportation Planning Intern"],
        ["AI/ML/Data", "Water Resources Intern"],
        ["AI/ML/Data", "Stormwater Intern - Wastewater Management"],
      ],
      false,
    );
    expectSoftware(
      [
        ["Other Engineering", "Infrastructure Engineering Summer Intern"],
        ["Other", "Infrastructure Automation Intern"],
        ["Other", "Research Intern (Inference Infrastructure) - 2027 Start (PhD)"],
        ["AI/ML/Data", "Data Analyst Intern - Waterloo"],
        ["ai", "Openshift AI Sustaining Engineering Intern- Waterford office - Ireland"],
      ],
      true,
    );
  });
});
