import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  filterThirdPartyAnalyticsErrors,
  isThirdPartyAnalyticsError,
} from "@/lib/sentry/third-party-error-filter";

function createErrorEvent(
  message: string,
  frames: Array<{ filename?: string }> = [],
): ErrorEvent {
  return {
    exception: {
      values: [
        {
          value: message,
          stacktrace: {
            frames,
          },
        },
      ],
    },
  };
}

describe("isThirdPartyAnalyticsError", () => {
  it("returns true for Plausible fetch failures", () => {
    const event = createErrorEvent(
      "TypeError: Failed to fetch (plausible.io)",
      [
        {
          filename:
            "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
        },
      ],
    );

    expect(isThirdPartyAnalyticsError(event)).toBe(true);
  });

  it("returns true for LinkedIn pixel fetch failures", () => {
    const event = createErrorEvent(
      "TypeError: Failed to fetch (px.ads.linkedin.com)",
    );

    expect(isThirdPartyAnalyticsError(event)).toBe(true);
  });

  it("returns false for first-party server action fetch failures", () => {
    const event = createErrorEvent("TypeError: Failed to fetch", [
      {
        filename:
          "node_modules/next/src/client/components/router-reducer/reducers/server-action-reducer.ts",
      },
    ]);

    expect(isThirdPartyAnalyticsError(event)).toBe(false);
  });

  it("returns false for generic fetch failures without third-party frames", () => {
    const event = createErrorEvent("TypeError: Failed to fetch", [
      {
        filename: "webpack-internal:///./src/lib/clients/core.shared.ts",
      },
    ]);

    expect(isThirdPartyAnalyticsError(event)).toBe(false);
  });
});

describe("filterThirdPartyAnalyticsErrors", () => {
  it("drops third-party analytics events", () => {
    const event = createErrorEvent("TypeError: Failed to fetch (plausible.io)");

    expect(filterThirdPartyAnalyticsErrors(event, {})).toBeNull();
  });

  it("passes through first-party events", () => {
    const event = createErrorEvent("TypeError: Failed to fetch", [
      {
        filename:
          "node_modules/next/src/client/components/router-reducer/reducers/server-action-reducer.ts",
      },
    ]);

    expect(filterThirdPartyAnalyticsErrors(event, {})).toBe(event);
  });
});
