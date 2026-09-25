import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLog, type Log } from "../src/log.ts";
import { watch } from "../src/watch.ts";

const at = new Date(2026, 8, 24, 21, 45, 3);

let dir: string;
let printed: string[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jobbo-log-"));
  printed = [];
  for (const method of ["log", "warn", "error"] as const) {
    spyOn(console, method).mockImplementation((text: string) => printed.push(text));
  }
});
afterEach(() => {
  rmSync(dir, { recursive: true });
});

describe("createLog", () => {
  test("stamps every line and appends the same lines to the file", () => {
    const file = join(dir, "jobbo.log");
    const log = createLog(file, () => at);
    log.info("run started");
    log.warn("two\nlines");
    log.error("boom");
    const expected = [
      "2026-09-24 21:45:03 run started",
      "2026-09-24 21:45:03 WARN two\n2026-09-24 21:45:03 WARN lines",
      "2026-09-24 21:45:03 ERROR boom",
    ];
    expect(printed).toEqual(expected);
    expect(readFileSync(file, "utf8")).toBe(`${expected.join("\n")}\n`);
  });

  test("keeps logging to the terminal when the file can't be written", () => {
    const log = createLog(join(dir, "missing", "jobbo.log"), () => at);
    log.info("one");
    log.info("two");
    expect(printed).toHaveLength(3);
    expect(printed[1]).toContain("can't write to");
    expect(printed[2]).toBe("2026-09-24 21:45:03 two");
  });
});

describe("watch", () => {
  const quiet: Log = { info() {}, warn() {}, error() {} };

  test("runs repeatedly until aborted, and a failing run doesn't stop it", async () => {
    const stop = new AbortController();
    let runs = 0;
    const errors: string[] = [];
    await watch(
      async () => {
        runs++;
        if (runs === 2) throw new Error("feed exploded");
        if (runs === 4) stop.abort();
      },
      { everyMs: 5, log: { ...quiet, error: (message) => errors.push(message) }, signal: stop.signal },
    );
    expect(runs).toBe(4);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("feed exploded");
  });

  test("an abort while waiting stops at once", async () => {
    const stop = new AbortController();
    let runs = 0;
    const started = performance.now();
    const done = watch(
      async () => {
        runs++;
      },
      { everyMs: 60_000, log: quiet, signal: stop.signal },
    );
    await Bun.sleep(20);
    stop.abort();
    await done;
    expect(runs).toBe(1);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("an abort during a run lets it finish", async () => {
    const stop = new AbortController();
    let finished = false;
    await watch(
      async () => {
        stop.abort();
        await Bun.sleep(10);
        finished = true;
      },
      { everyMs: 5, log: quiet, signal: stop.signal },
    );
    expect(finished).toBe(true);
  });
});
