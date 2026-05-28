import type { ErrorEvent, EventHint } from "@sentry/core";
import { describe, expect, it } from "vitest";

import {
  dropThirdPartyAnalyticsNoise,
  isPlausibleAnalyticsFetchFailure,
} from "@/lib/sentry/drop-third-party-analytics-noise";

function createErrorEvent(partial: Partial<ErrorEvent>): ErrorEvent {
  return {
    event_id: "test-event",
    platform: "javascript",
    timestamp: 0,
    ...partial,
  };
}

const hint = {} as EventHint;

describe("isPlausibleAnalyticsFetchFailure", () => {
  it("matches plausible.io fetch failures from the error message", () => {
    const event = createErrorEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (plausible.io)",
          },
        ],
      },
    });

    expect(isPlausibleAnalyticsFetchFailure(event)).toBe(true);
  });

  it("matches when the plausible script appears in the stack trace", () => {
    const event = createErrorEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch",
            stacktrace: {
              frames: [
                {
                  filename:
                    "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
                },
              ],
            },
          },
        ],
      },
    });

    expect(isPlausibleAnalyticsFetchFailure(event)).toBe(true);
  });

  it("does not match unrelated application fetch failures", () => {
    const event = createErrorEvent({
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
    });

    expect(isPlausibleAnalyticsFetchFailure(event)).toBe(false);
  });
});

describe("dropThirdPartyAnalyticsNoise", () => {
  it("drops plausible analytics noise events", () => {
    const event = createErrorEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (plausible.io)",
          },
        ],
      },
    });

    expect(dropThirdPartyAnalyticsNoise(event, hint)).toBeNull();
  });

  it("keeps real application errors", () => {
    const event = createErrorEvent({
      exception: {
        values: [
          {
            type: "Error",
            value: "Failed to fetch job",
          },
        ],
      },
    });

    expect(dropThirdPartyAnalyticsNoise(event, hint)).toBe(event);
  });
});
