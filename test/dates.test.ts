import { afterEach, describe, expect, test } from "bun:test";
import {
  addDays,
  daysBetween,
  ecrPostedDay,
  etDay,
  isDay,
  parseEcrTimestamp,
  simplifyPostedDay,
  speedyapplyPostedDay,
  zapplyPostedDay,
  zshahPostedDay,
} from "../src/dates.ts";

const at = (iso: string) => new Date(iso);

describe("etDay", () => {
  const machineZone = process.env.TZ;
  afterEach(() => {
    if (machineZone === undefined) delete process.env.TZ;
    else process.env.TZ = machineZone;
  });

  test("changes day at New York midnight (EDT)", () => {
    expect(etDay(at("2026-09-24T03:59:59Z"))).toBe("2026-09-23");
    expect(etDay(at("2026-09-24T04:00:00Z"))).toBe("2026-09-24");
    expect(etDay(at("2026-09-25T03:59:59.999Z"))).toBe("2026-09-24");
  });

  test("spring forward on 2026-03-08", () => {
    // Midnight before the switch is EST (UTC-5), the next midnight is EDT (UTC-4).
    expect(etDay(at("2026-03-08T04:59:59Z"))).toBe("2026-03-07");
    expect(etDay(at("2026-03-08T05:00:00Z"))).toBe("2026-03-08");
    expect(etDay(at("2026-03-08T07:00:00Z"))).toBe("2026-03-08");
    expect(etDay(at("2026-03-09T03:59:59Z"))).toBe("2026-03-08");
    expect(etDay(at("2026-03-09T04:00:00Z"))).toBe("2026-03-09");
  });

  test("fall back on 2026-11-01", () => {
    expect(etDay(at("2026-11-01T03:59:59Z"))).toBe("2026-10-31");
    expect(etDay(at("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
    expect(etDay(at("2026-11-01T06:30:00Z"))).toBe("2026-11-01");
    expect(etDay(at("2026-11-02T04:59:59Z"))).toBe("2026-11-01");
    expect(etDay(at("2026-11-02T05:00:00Z"))).toBe("2026-11-02");
  });

  test("ignores the machine time zone", () => {
    process.env.TZ = "Pacific/Kiritimati";
    expect(etDay(at("2026-09-24T03:59:59Z"))).toBe("2026-09-23");
    process.env.TZ = "Pacific/Pago_Pago";
    expect(etDay(at("2026-09-24T04:00:00Z"))).toBe("2026-09-24");
  });
});

describe("isDay", () => {
  test("accepts real calendar days only", () => {
    expect(isDay("2026-09-24")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("2026-9-24")).toBe(false);
    expect(isDay("2026-09-24T00:00:00Z")).toBe(false);
    expect(isDay(null)).toBe(false);
    expect(isDay(20260924)).toBe(false);
  });
});

describe("addDays and daysBetween", () => {
  test("cross month, year and leap-day boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-09-24", -7)).toBe("2026-09-17");
    expect(addDays("2026-09-24", 0)).toBe("2026-09-24");
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
    expect(daysBetween("2026-09-24", "2026-09-20")).toBe(-4);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });

  test("do not drift across DST changes", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(daysBetween("2026-03-01", "2026-03-15")).toBe(14);
    expect(daysBetween("2026-10-25", "2026-11-08")).toBe(14);
  });
});

describe("parseEcrTimestamp", () => {
  const iso = (text: unknown) => parseEcrTimestamp(text)?.toISOString();

  test("reads Postgres-style timestamps with any offset form", () => {
    expect(iso("2026-09-24 16:19:50.23751+00")).toBe("2026-09-24T16:19:50.237Z");
    expect(iso("2026-09-24T16:19:50Z")).toBe("2026-09-24T16:19:50.000Z");
    expect(iso("2026-09-24 16:19:50.123Z")).toBe("2026-09-24T16:19:50.123Z");
    expect(iso("2026-09-24 16:19:50+05:30")).toBe("2026-09-24T10:49:50.000Z");
    expect(iso("2026-09-24 16:19:50.5+0530")).toBe("2026-09-24T10:49:50.500Z");
    expect(iso("2026-09-24 16:19:50-04")).toBe("2026-09-24T20:19:50.000Z");
    expect(iso("2026-09-24 16:19:50+00")).toBe("2026-09-24T16:19:50.000Z");
    expect(iso(" 2026-09-24 16:19:50.2+00 ")).toBe("2026-09-24T16:19:50.200Z");
  });

  test("rejects anything else", () => {
    expect(iso("garbage")).toBeUndefined();
    expect(iso("")).toBeUndefined();
    expect(iso("2026-09-24 16:19:50")).toBeUndefined();
    expect(iso("2026-09-24")).toBeUndefined();
    expect(iso("2026-09-24 25:19:50+00")).toBeUndefined();
    expect(iso("2026-02-30 10:00:00+00")).toBeUndefined();
    expect(iso(null)).toBeUndefined();
    expect(iso(1790208000)).toBeUndefined();
  });
});

describe("ecrPostedDay", () => {
  test("prefers the ATS posting day", () => {
    expect(ecrPostedDay("2026-09-20", "2026-09-24 16:19:50.23751+00")).toBe("2026-09-20");
  });

  test("falls back to the New York day ECR first saw the job", () => {
    expect(ecrPostedDay(null, "2026-09-25 03:30:00.1+00")).toBe("2026-09-24");
    expect(ecrPostedDay(null, "2026-09-25 04:30:00.1+00")).toBe("2026-09-25");
    expect(ecrPostedDay("2026-02-30", "2026-09-24 16:19:50+00")).toBe("2026-09-24");
    expect(ecrPostedDay("2026-09-20T00:00:00Z", "2026-09-24 16:19:50+00")).toBe("2026-09-24");
  });

  test("is undefined when neither date parses", () => {
    expect(ecrPostedDay(null, null)).toBeUndefined();
    expect(ecrPostedDay("soon", "garbage")).toBeUndefined();
  });
});

describe("simplifyPostedDay", () => {
  test("uses the UTC date for midnight-UTC calendar dates", () => {
    expect(simplifyPostedDay(1790208000)).toBe("2026-09-24");
  });

  test("uses the New York day for real instants", () => {
    expect(simplifyPostedDay(1790222399)).toBe("2026-09-23");
    expect(simplifyPostedDay(1790222400)).toBe("2026-09-24");
  });

  test("is undefined for invalid values", () => {
    for (const value of ["1790208000", Number.NaN, Number.POSITIVE_INFINITY, 0, -86_400, null, undefined]) {
      expect(simplifyPostedDay(value)).toBeUndefined();
    }
  });
});

describe("speedyapplyPostedDay", () => {
  test("counts back from today's regeneration from 12:30Z (08:30 EDT)", () => {
    expect(speedyapplyPostedDay(at("2026-09-24T12:30:00Z"), "0d")).toBe("2026-09-24");
    expect(speedyapplyPostedDay(at("2026-09-24T18:00:00Z"), "3d")).toBe("2026-09-21");
    expect(speedyapplyPostedDay(at("2026-09-25T03:00:00Z"), "1d")).toBe("2026-09-23");
    expect(speedyapplyPostedDay(at("2026-09-24T18:00:00Z"), "119d")).toBe("2026-05-28");
  });

  test("uses the previous day's file before 12:30Z, including after New York midnight", () => {
    expect(speedyapplyPostedDay(at("2026-09-24T12:29:59Z"), "0d")).toBe("2026-09-23");
    expect(speedyapplyPostedDay(at("2026-09-24T08:00:00Z"), "0d")).toBe("2026-09-23");
    expect(speedyapplyPostedDay(at("2026-09-25T05:00:00Z"), "2d")).toBe("2026-09-22");
  });

  test("keeps the UTC cutoff in winter, when the cron lands from 07:48 EST", () => {
    expect(speedyapplyPostedDay(at("2026-12-01T12:29:00Z"), "0d")).toBe("2026-11-30");
    expect(speedyapplyPostedDay(at("2026-12-01T12:30:00Z"), "0d")).toBe("2026-12-01");
    expect(speedyapplyPostedDay(at("2026-12-01T13:00:00Z"), "0d")).toBe("2026-12-01");
    expect(speedyapplyPostedDay(at("2026-12-02T04:30:00Z"), "0d")).toBe("2026-12-01");
    expect(speedyapplyPostedDay(at("2026-12-02T05:30:00Z"), "0d")).toBe("2026-12-01");
    expect(speedyapplyPostedDay(at("2026-11-01T12:45:00Z"), "1d")).toBe("2026-10-31");
    expect(speedyapplyPostedDay(at("2026-03-08T12:45:00Z"), "1d")).toBe("2026-03-07");
  });

  test("tolerates padding but rejects bad ages", () => {
    expect(speedyapplyPostedDay(at("2026-09-24T18:00:00Z"), " 3d ")).toBe("2026-09-21");
    for (const age of ["", "3", "d", "-1d", "1.5d", "3 days", "3D", "new", "12345d"]) {
      expect(speedyapplyPostedDay(at("2026-09-24T18:00:00Z"), age)).toBeUndefined();
    }
  });
});

describe("zshahPostedDay", () => {
  test("a date_only posted_at is that calendar day", () => {
    expect(zshahPostedDay("2026-09-24T00:00:00Z", "date_only", "2026-09-25T02:00:00Z")).toBe("2026-09-24");
  });

  test("an exact posted_at is its New York day", () => {
    expect(zshahPostedDay("2026-09-02T21:47:29.454+00:00", "exact", "2026-09-02T22:53:50Z")).toBe("2026-09-02");
    expect(zshahPostedDay("2026-09-03T02:00:00Z", "exact", "2026-09-03T02:30:00Z")).toBe("2026-09-02");
    expect(zshahPostedDay("2026-08-24T16:37:48-04:00", "relative_derived", null)).toBe("2026-08-24");
  });

  test("without a usable posted_at, uses the New York day of first_seen_at", () => {
    expect(zshahPostedDay(null, undefined, "2026-06-30T19:49:56Z")).toBe("2026-06-30");
    expect(zshahPostedDay("soon", "date_only", "2026-07-01T03:00:00Z")).toBe("2026-06-30");
  });

  test("is undefined when neither date parses", () => {
    expect(zshahPostedDay(null, null, null)).toBeUndefined();
    expect(zshahPostedDay("soon", "exact", "later")).toBeUndefined();
  });
});

describe("zapplyPostedDay", () => {
  const evening = at("2026-09-29T21:30:00Z");

  test("counts minutes, hours and days back from the fetch, in New York days", () => {
    expect(zapplyPostedDay(evening, "33m")).toBe("2026-09-29");
    expect(zapplyPostedDay(evening, "18h")).toBe("2026-09-28");
    expect(zapplyPostedDay(evening, "1d")).toBe("2026-09-28");
    expect(zapplyPostedDay(evening, "6d")).toBe("2026-09-23");
    expect(zapplyPostedDay(at("2026-09-30T04:30:00Z"), "10m")).toBe("2026-09-30");
  });

  test("a week counts its far end, so a week-old row is never fresh", () => {
    expect(zapplyPostedDay(evening, "1w")).toBe("2026-09-16");
    expect(zapplyPostedDay(evening, "2w")).toBe("2026-09-09");
  });

  test("tolerates padding but rejects anything else", () => {
    expect(zapplyPostedDay(evening, " 4h ")).toBe("2026-09-29");
    for (const age of ["", "Date unknown", "3", "m", "-1d", "1.5d", "3 days", "3D", "1y", "12345d"]) {
      expect(zapplyPostedDay(evening, age)).toBeUndefined();
    }
  });
});
