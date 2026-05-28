import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  beforeSendClientEvent,
  shouldDropThirdPartyAnalyticsEvent,
} from "@/lib/sentry/client-filters";

function createFetchErrorEvent(
  message: string,
  frames: string[] = [],
): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: message,
          stacktrace: {
            frames: frames.map((filename) => ({ filename })),
          },
        },
      ],
    },
  };
}

describe("shouldDropThirdPartyAnalyticsEvent", () => {
  it("drops LinkedIn Insight Tag fetch failures", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch (px.ads.linkedin.com)",
      ["app:///li.lms-analytics/insight.old.min.js"],
    );

    expect(shouldDropThirdPartyAnalyticsEvent(event)).toBe(true);
  });

  it("drops plausible.io fetch failures", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch (plausible.io)",
    );

    expect(shouldDropThirdPartyAnalyticsEvent(event)).toBe(true);
  });

  it("drops Usercentrics dynamic import failures", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/TvGdprCmpView.9fffdb6f.js. Error: undefined",
    );

    expect(shouldDropThirdPartyAnalyticsEvent(event)).toBe(true);
  });

  it("keeps app fetch failures", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch (app.sokosumi.com)",
    );

    expect(shouldDropThirdPartyAnalyticsEvent(event)).toBe(false);
  });

  it("keeps API fetch failures", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch (api.sokosumi.com)",
    );

    expect(shouldDropThirdPartyAnalyticsEvent(event)).toBe(false);
  });

  it("keeps first-party onboarding errors", () => {
    const event: ErrorEvent = {
      message: "Error: Failed to fetch onboarding progress",
    };

    expect(shouldDropThirdPartyAnalyticsEvent(event)).toBe(false);
  });

  it("drops generic fetch failures when stack frames are third-party analytics", () => {
    const event = createFetchErrorEvent("TypeError: Failed to fetch", [
      "app:///li.lms-analytics/insight.old.min.js",
    ]);

    expect(shouldDropThirdPartyAnalyticsEvent(event)).toBe(true);
  });
});

describe("beforeSendClientEvent", () => {
  it("returns null for third-party analytics noise", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch (px.ads.linkedin.com)",
    );

    expect(beforeSendClientEvent(event, {})).toBeNull();
  });

  it("returns the event for first-party failures", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch (app.sokosumi.com)",
    );

    expect(beforeSendClientEvent(event, {})).toBe(event);
  });
});
