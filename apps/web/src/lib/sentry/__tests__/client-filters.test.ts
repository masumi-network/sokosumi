import { describe, expect, it } from "vitest";

import {
  filterClientSentryEvent,
  SENTRY_CLIENT_IGNORE_ERRORS,
} from "@/lib/sentry/client-filters";

describe("filterClientSentryEvent", () => {
  it("drops LinkedIn Insight Tag fetch failures", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (px.ads.linkedin.com)",
            stacktrace: {
              frames: [
                {
                  filename: "app:///li.lms-analytics/insight.old.min.js",
                },
              ],
            },
          },
        ],
      },
    };

    expect(
      filterClientSentryEvent(event, {
        originalException: new TypeError(
          "Failed to fetch (px.ads.linkedin.com)",
        ),
      }),
    ).toBeNull();
  });

  it("keeps first-party fetch failures", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch",
            stacktrace: {
              frames: [
                {
                  filename:
                    "webpack-internal:///./src/lib/clients/core.shared.ts",
                },
              ],
            },
          },
        ],
      },
    };

    expect(
      filterClientSentryEvent(event, {
        originalException: new TypeError("Failed to fetch"),
      }),
    ).toBe(event);
  });

  it("documents ignore patterns for Sentry init", () => {
    expect(SENTRY_CLIENT_IGNORE_ERRORS.length).toBeGreaterThan(0);
  });
});
