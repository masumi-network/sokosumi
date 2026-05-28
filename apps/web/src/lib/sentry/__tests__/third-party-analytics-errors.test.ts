import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  filterThirdPartyAnalyticsFetchError,
  shouldIgnoreThirdPartyAnalyticsFetchError,
  thirdPartyAnalyticsFetchIgnorePatterns,
} from "@/lib/sentry/third-party-analytics-errors";

function createErrorEvent(
  message: string,
  filenames: string[] = [],
): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: message,
          stacktrace: {
            frames: filenames.map((filename) => ({ filename })),
          },
        },
      ],
    },
  } as ErrorEvent;
}

describe("shouldIgnoreThirdPartyAnalyticsFetchError", () => {
  it("ignores plausible.io failed fetch errors", () => {
    const event = createErrorEvent("TypeError: Failed to fetch (plausible.io)");

    expect(shouldIgnoreThirdPartyAnalyticsFetchError(event)).toBe(true);
  });

  it("ignores other third-party analytics hosts", () => {
    expect(
      shouldIgnoreThirdPartyAnalyticsFetchError(
        createErrorEvent("TypeError: Failed to fetch (px.ads.linkedin.com)"),
      ),
    ).toBe(true);
    expect(
      shouldIgnoreThirdPartyAnalyticsFetchError(
        createErrorEvent(
          "TypeError: Failed to fetch (region1.google-analytics.com)",
        ),
      ),
    ).toBe(true);
  });

  it("does not ignore first-party failed fetch errors", () => {
    const event = createErrorEvent(
      "TypeError: Failed to fetch (app.sokosumi.com)",
    );

    expect(shouldIgnoreThirdPartyAnalyticsFetchError(event)).toBe(false);
  });

  it("ignores plausible script stack frames when the message is generic", () => {
    const event = createErrorEvent("TypeError: Failed to fetch", [
      "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
    ]);

    expect(shouldIgnoreThirdPartyAnalyticsFetchError(event)).toBe(true);
  });

  it("does not ignore generic failed fetch errors without analytics frames", () => {
    const event = createErrorEvent("TypeError: Failed to fetch", [
      "app:///src/hooks/use-job-submission.ts",
    ]);

    expect(shouldIgnoreThirdPartyAnalyticsFetchError(event)).toBe(false);
  });
});

describe("filterThirdPartyAnalyticsFetchError", () => {
  it("returns null for ignored analytics errors", () => {
    const event = createErrorEvent("TypeError: Failed to fetch (plausible.io)");

    expect(filterThirdPartyAnalyticsFetchError(event)).toBeNull();
  });

  it("returns the event for actionable errors", () => {
    const event = createErrorEvent(
      "TypeError: Failed to fetch (app.sokosumi.com)",
    );

    expect(filterThirdPartyAnalyticsFetchError(event)).toBe(event);
  });
});

describe("thirdPartyAnalyticsFetchIgnorePatterns", () => {
  it("matches plausible.io errors", () => {
    const matches = thirdPartyAnalyticsFetchIgnorePatterns.some((pattern) =>
      pattern.test("TypeError: Failed to fetch (plausible.io)"),
    );

    expect(matches).toBe(true);
  });
});
