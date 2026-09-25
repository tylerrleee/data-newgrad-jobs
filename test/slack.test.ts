import { WebAPIPlatformError, WebAPIRateLimitedError, WebAPIRequestError } from "@slack/web-api";
import { describe, expect, test } from "bun:test";
import { classifySlackError, renderJob } from "../src/slack.ts";

const base = {
  title: "Software Developer Intern",
  company: "Booz Allen",
  url: "https://careers.example.com/job?id=1&team=a",
  locations: ["McLean, VA"],
  sources: ["Simplify", "speedyapply"],
  moreInThread: 0,
};

function text(message: typeof base): string {
  const block = renderJob(message).blocks[0] as { text: { text: string } };
  return block.text.text;
}

describe("renderJob", () => {
  test("bold company, title link and locations on their own lines, no sources", () => {
    expect(text(base)).toBe(
      "*Booz Allen*\n" + "<https://careers.example.com/job?id=1&amp;team=a|Software Developer Intern>\n" + "McLean, VA",
    );
    expect(renderJob(base).text).toBe("Software Developer Intern at Booz Allen");
    expect(renderJob(base).blocks.map((block) => block.type)).toEqual(["section", "divider"]);
  });

  test("shows three locations and counts the rest", () => {
    const locations = ["McLean, VA", "Annapolis Junction, MD", "Remote", "Denver, CO", "Austin, TX"];
    expect(text({ ...base, locations }).split("\n")[2]).toBe(
      "McLean, VA; Annapolis Junction, MD; Remote +2 more",
    );
    expect(text({ ...base, locations: [] }).split("\n")).toHaveLength(2);
  });

  test("thread counts", () => {
    expect(text({ ...base, moreInThread: 1 })).toEndWith("└ 1 more opening in thread");
    expect(text({ ...base, moreInThread: 14 })).toEndWith("└ 14 more openings in thread");
  });

  test("escapes mrkdwn control characters", () => {
    const rendered = text({ ...base, title: "R&D <Intern> | Data", url: "https://x.example/a|b" });
    expect(rendered.split("\n")[1]).toBe("<https://x.example/a%7Cb|R&amp;D &lt;Intern&gt; | Data>");
  });

  test("truncates very long titles", () => {
    expect(renderJob({ ...base, title: "x".repeat(500) }).text.length).toBeLessThan(250);
  });
});

describe("classifySlackError", () => {
  test("rate limits and connection failures never posted", () => {
    expect(classifySlackError(new WebAPIRateLimitedError(10))).toBe("retry");
    expect(classifySlackError(new WebAPIPlatformError({ ok: false, error: "not_in_channel" }))).toBe("retry");
    const refused = new WebAPIRequestError(Object.assign(new TypeError("x"), { code: "ConnectionRefused" }));
    expect(classifySlackError(refused)).toBe("retry");
  });

  test("invalid messages can't succeed on retry", () => {
    expect(classifySlackError(new WebAPIPlatformError({ ok: false, error: "invalid_blocks" }))).toBe("failed");
  });

  test("anything that may have posted is unknown", () => {
    expect(classifySlackError(new WebAPIPlatformError({ ok: false, error: "internal_error" }))).toBe("unknown");
    expect(classifySlackError(new WebAPIRequestError(new Error("socket hang up")))).toBe("unknown");
    expect(classifySlackError(new Error("boom"))).toBe("unknown");
  });
});
