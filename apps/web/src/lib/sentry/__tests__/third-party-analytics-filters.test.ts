import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  beforeSendDropThirdPartyAnalytics,
  shouldDropThirdPartyAnalyticsEvent,
} from "@/lib/sentry/third-party-analytics-filters";

function createPlausibleFetchErrorEvent(): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: "TypeError: Failed to fetch (plausible.io)",
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
  };
}

describe("shouldDropThirdPartyAnalyticsEvent", () => {
  it("drops the canonical Plausible fetch failure message", () => {
    expect(
      shouldDropThirdPartyAnalyticsEvent(createPlausibleFetchErrorEvent()),
    ).toBe(true);
  });

  it("drops fetch failures when stack frames reference Plausible scripts", () => {
    const event: ErrorEvent = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch",
            stacktrace: {
              frames: [
                {
                  filename:
                    "https://plausible.io/js/script.outbound-links.pageview-props.js",
                },
              ],
            },
          },
        ],
      },
    };

    expect(shouldDropThirdPartyAnalyticsEvent(event)).toBe(true);
  });

  it("keeps unrelated application errors", () => {
    const event: ErrorEvent = {
      exception: {
        values: [
          {
            type: "Error",
            value: "Failed to fetch user profile",
            stacktrace: {
              frames: [
                {
                  filename: "app:///_next/static/chunks/app/tasks/page.js",
                },
              ],
            },
          },
        ],
      },
    };

    expect(shouldDropThirdPartyAnalyticsEvent(event)).toBe(false);
  });
});

describe("beforeSendDropThirdPartyAnalytics", () => {
  it("returns null for dropped events", () => {
    expect(
      beforeSendDropThirdPartyAnalytics(createPlausibleFetchErrorEvent(), {
        event_id: "test",
      }),
    ).toBeNull();
  });
});
