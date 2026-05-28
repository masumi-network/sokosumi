import { describe, expect, it } from "vitest";

import {
  filterThirdPartyAnalyticsClientEvent,
  shouldDropThirdPartyAnalyticsClientEvent,
} from "@/lib/sentry/client-event-filters";

describe("shouldDropThirdPartyAnalyticsClientEvent", () => {
  it("drops plausible fetch failures reported as unhandled rejections", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (plausible.io)",
          },
        ],
      },
    };

    expect(shouldDropThirdPartyAnalyticsClientEvent(event)).toBe(true);
    expect(filterThirdPartyAnalyticsClientEvent(event)).toBeNull();
  });

  it("drops events whose stack frames originate from the plausible script", () => {
    const event = {
      message: "Network error",
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                {
                  filename:
                    "https://plausible.io/js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
                },
              ],
            },
          },
        ],
      },
    };

    expect(shouldDropThirdPartyAnalyticsClientEvent(event)).toBe(true);
  });

  it("keeps application fetch failures", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch",
          },
        ],
      },
    };

    expect(shouldDropThirdPartyAnalyticsClientEvent(event)).toBe(false);
    expect(filterThirdPartyAnalyticsClientEvent(event)).toBe(event);
  });
});
