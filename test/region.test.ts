import { describe, expect, test } from "bun:test";
import { isInternational, locationRegion, titleNamesAbroad } from "../src/region.ts";

describe("locationRegion", () => {
  test("US locations in each source's style", () => {
    for (const location of [
      "New York, NY",
      "Remote in USA",
      "San Jose, California, United States",
      "NYC",
      "South SF",
      "Boise, ID - Main Site",
      "Atlanta GA",
      "1720 W Rio Salado Pkwy Tempe, AZ 85281",
      "Multiple U.S. locations",
      "Chicago Office",
      "San Francisco, CA +1",
      "Washington, DC",
      "California",
    ]) {
      expect([location, locationRegion(location)]).toEqual([location, "us"]);
    }
  });

  test("foreign locations in each source's style", () => {
    for (const location of [
      "Toronto, ON, Canada",
      "Toronto, ON",
      "London, UK",
      "Remote in Canada",
      "Singapore",
      "Fab 10N/X, Singapore",
      "Bengaluru, Karnataka, IND",
      "Mexico City, Mexico City, MEX",
      "Sydney, New South Wales, Australia",
      "Seoul, Korea, Republic of",
      "Hong Kong +1",
      "London",
      "Jersey",
    ]) {
      expect([location, locationRegion(location)]).toEqual([location, "abroad"]);
    }
  });

  test("US towns named after countries stay in the US", () => {
    for (const location of ["Holland, MI", "North Wales, PA", "Malta, NY", "Panama City, FL", "Denmark, WI"]) {
      expect([location, locationRegion(location)]).toEqual([location, "us"]);
    }
    expect(locationRegion("New Mexico")).toBe("us");
    expect(locationRegion("Jersey City, NJ")).toBe("us");
  });

  test("codes shared by states and countries", () => {
    expect(locationRegion("Bengaluru, KA, IN")).toBe("abroad");
    expect(locationRegion("Toronto, ON, CA")).toBe("abroad");
    expect(locationRegion("Latin America")).toBe("abroad");
  });

  test("locations without a place are unclear", () => {
    expect(locationRegion("Remote")).toBe("unknown");
    expect(locationRegion("Hybrid")).toBe("unknown");
  });
});

describe("isInternational", () => {
  const at = (...locations: string[]) => ({ feed: "simplify", locations });

  test("a job only abroad is international", () => {
    expect(isInternational([at("Toronto, ON, Canada"), { feed: "ecr", locations: ["Singapore"] }])).toBe(true);
  });

  test("any US location in any listing keeps the job", () => {
    expect(isInternational([at("Toronto, ON, Canada", "New York, NY")])).toBe(false);
    expect(isInternational([at("London, UK"), { feed: "ecr", locations: ["Remote in USA"] }])).toBe(false);
  });

  test("unclear or missing locations keep the job", () => {
    expect(isInternational([at("Remote")])).toBe(false);
    expect(isInternational([at()])).toBe(false);
  });

  test("speedyapply's US and international files decide for their rows", () => {
    expect(isInternational([{ feed: "speedyapply-swe-intl", locations: ["Remote"] }])).toBe(true);
    expect(isInternational([{ feed: "speedyapply-ai-us", locations: ["London, United Kingdom +2"] }])).toBe(false);
  });

  test("a title that names a place abroad outranks speedyapply's US file", () => {
    const redHat = {
      feed: "speedyapply-swe-us",
      title: "Software Engineering Internship - Ireland",
      locations: ["Waterford, Ireland +2"],
    };
    expect(isInternational([redHat])).toBe(true);
    expect(isInternational([{ ...redHat, title: "Software Engineer Intern - Dublin office" }])).toBe(true);
    expect(isInternational([{ ...redHat, title: "Software Engineering Internship" }])).toBe(false);
    // A US location still keeps the job.
    expect(isInternational([{ ...redHat, locations: ["Waterford, Ireland", "Boston, MA"] }])).toBe(false);
  });
});

describe("titleNamesAbroad", () => {
  test("countries and cities abroad", () => {
    expect(titleNamesAbroad("Software Engineering Internship - Ireland")).toBe(true);
    expect(titleNamesAbroad("Openshift AI Sustaining Engineering Intern- Waterford office - Ireland")).toBe(true);
    expect(titleNamesAbroad("Data Analyst Intern - London")).toBe(true);
  });

  test("US places, and codes that are words in a title", () => {
    expect(titleNamesAbroad("Software Engineer Intern")).toBe(false);
    expect(titleNamesAbroad("Software Engineer Intern - New Jersey")).toBe(false);
    expect(titleNamesAbroad("Software Engineer Intern, US - Europe Payments")).toBe(false);
    expect(titleNamesAbroad("Embedded Software Intern - CAN Bus")).toBe(false);
  });
});
