import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { shouldIgnoreClientError } from "@/lib/sentry/client-error-filter";

function createEvent(message: string): ErrorEvent {
  return {
    exception: {
      values: [{ value: message, type: "TypeError" }],
    },
  };
}

function createHint(message: string): EventHint {
  return { originalException: new TypeError(message) };
}

describe("shouldIgnoreClientError", () => {
  it("ignores LinkedIn Insight Tag fetch failures", () => {
    const message = "TypeError: Failed to fetch (px.ads.linkedin.com)";
    expect(
      shouldIgnoreClientError(createEvent(message), createHint(message)),
    ).toBe(true);
  });

  it("ignores plausible.io fetch failures", () => {
    const message = "TypeError: Failed to fetch (plausible.io)";
    expect(
      shouldIgnoreClientError(createEvent(message), createHint(message)),
    ).toBe(true);
  });

  it("ignores Google Ads syndication fetch failures", () => {
    const message =
      "TypeError: Failed to fetch (pagead2.googlesyndication.com)";
    expect(
      shouldIgnoreClientError(createEvent(message), createHint(message)),
    ).toBe(true);
  });

  it("ignores Usercentrics dynamic import failures", () => {
    const message =
      "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/TvGdprCmpView.a460128e.js. Error: undefined";
    expect(
      shouldIgnoreClientError(createEvent(message), createHint(message)),
    ).toBe(true);
  });

  it("keeps Sokosumi API fetch failures", () => {
    const message = "TypeError: Failed to fetch (app.sokosumi.com)";
    expect(
      shouldIgnoreClientError(createEvent(message), createHint(message)),
    ).toBe(false);
  });

  it("keeps Core API fetch failures", () => {
    const message = "TypeError: Failed to fetch (api.sokosumi.com)";
    expect(
      shouldIgnoreClientError(createEvent(message), createHint(message)),
    ).toBe(false);
  });

  it("keeps generic fetch failures without a known marketing host", () => {
    const message = "TypeError: Failed to fetch";
    expect(
      shouldIgnoreClientError(createEvent(message), createHint(message)),
    ).toBe(false);
  });
});
