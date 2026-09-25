import { canonicalKey } from "../src/canonical.ts";
import type { Listing } from "../src/job.ts";

export function listing(overrides: Partial<Listing> & { sourceId: string; url: string }): Listing {
  return {
    key: canonicalKey(overrides.url),
    company: "Acme",
    title: "Software Engineer Intern",
    locations: ["New York, NY"],
    category: "Software",
    postedDay: "2026-09-24",
    software: true,
    internship: true,
    active: true,
    raw: JSON.stringify({ id: overrides.sourceId }),
    ...overrides,
  };
}

export const ecr = { name: "ecr", source: "ecr" } as const;
export const simplify = { name: "simplify", source: "simplify" } as const;
export const speedyapply = { name: "speedyapply-swe-us", source: "speedyapply" } as const;
