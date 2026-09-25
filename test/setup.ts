// Tests must never reach the real job sources or Slack.
const realFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return Promise.reject(new Error(`tests may not fetch ${url.origin}`));
    }
    return realFetch(input, init);
  },
  realFetch,
);
