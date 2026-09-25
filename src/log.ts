import { appendFileSync } from "node:fs";

export interface Log {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** "2026-09-24 21:45:03" in local time. */
export function timestamp(date: Date): string {
  return date.toLocaleString("sv-SE");
}

/** Writes timestamped lines to the terminal and, when a file is given, appends them to it. */
export function createLog(file?: string, now: () => Date = () => new Date()): Log {
  let fileFailed = false;
  const write = (level: "info" | "warn" | "error", message: string) => {
    const prefix = `${timestamp(now())}${level === "info" ? "" : ` ${level.toUpperCase()}`} `;
    const text = message
      .split("\n")
      .map((line) => prefix + line)
      .join("\n");
    (level === "info" ? console.log : level === "warn" ? console.warn : console.error)(text);
    if (!file || fileFailed) return;
    try {
      appendFileSync(file, `${text}\n`);
    } catch (error) {
      // Keep running on the terminal alone rather than failing every run.
      fileFailed = true;
      console.error(`${prefix}ERROR can't write to ${file}: ${error instanceof Error ? error.message : error}`);
    }
  };
  return {
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
  };
}
