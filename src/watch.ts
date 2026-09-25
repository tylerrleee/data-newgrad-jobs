import { timestamp, type Log } from "./log.ts";

/**
 * Calls `run` now and then every `everyMs` (measured from the start of each run) until `signal`
 * aborts. A run that throws is logged and the next one still happens. An abort during a run lets
 * it finish; an abort while waiting stops at once.
 */
export async function watch(
  run: () => Promise<unknown>,
  { everyMs, log, signal }: { everyMs: number; log: Log; signal: AbortSignal },
): Promise<void> {
  while (!signal.aborted) {
    const started = Date.now();
    try {
      await run();
    } catch (error) {
      log.error(`run failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
    if (signal.aborted) break;
    const next = new Date(started + everyMs);
    log.info(`next run at ${timestamp(next)}`);
    await sleepUntil(next, signal);
  }
}

function sleepUntil(time: Date, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, Math.max(0, time.getTime() - Date.now()));
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
