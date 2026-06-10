import { describe, expect, it } from "vitest";

import { ssrfSafeFetch } from "./url-guard";

// These exercise the real `request-filtering-agent`: the connection must be
// refused at connect time for non-public targets, with no network egress.
describe("ssrfSafeFetch (integration: address filtering)", () => {
  it.each([
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata endpoint
    "http://[::1]/",
  ])("refuses to connect to non-public target %s", async (url) => {
    await expect(ssrfSafeFetch(url)).rejects.toThrow();
  });
});
