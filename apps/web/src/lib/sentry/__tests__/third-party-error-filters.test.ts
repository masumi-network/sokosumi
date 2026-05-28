import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  filterThirdPartyAnalyticsErrors,
  isThirdPartyAnalyticsError,
} from "@/lib/sentry/third-party-error-filters";

function createFetchErrorEvent(
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

describe("isThirdPartyAnalyticsError", () => {
  it("filters LinkedIn Insight Tag fetch failures", () => {
    const event = createFetchErrorEvent(
      "Failed to fetch (px.ads.linkedin.com)",
      ["app:///li.lms-analytics/insight.old.min.js"],
    );

    expect(isThirdPartyAnalyticsError(event)).toBe(true);
    expect(filterThirdPartyAnalyticsErrors(event)).toBeNull();
  });

  it("filters plausible.io fetch failures", () => {
    const event = createFetchErrorEvent("Failed to fetch (plausible.io)");

    expect(isThirdPartyAnalyticsError(event)).toBe(true);
  });

  it("keeps app.sokosumi.com fetch failures", () => {
    const event = createFetchErrorEvent("Failed to fetch (app.sokosumi.com)");

    expect(isThirdPartyAnalyticsError(event)).toBe(false);
    expect(filterThirdPartyAnalyticsErrors(event)).toBe(event);
  });

  it("keeps api.sokosumi.com fetch failures", () => {
    const event = createFetchErrorEvent("Failed to fetch (api.sokosumi.com)");

    expect(isThirdPartyAnalyticsError(event)).toBe(false);
  });

  it("filters generic failed fetch errors from third-party scripts", () => {
    const event = createFetchErrorEvent("Failed to fetch", [
      "app:///frame_ant/frame_ant.js",
      "app:///li.lms-analytics/insight.old.min.js",
    ]);

    expect(isThirdPartyAnalyticsError(event)).toBe(true);
  });

  it("filters Usercentrics dynamic import failures", () => {
    const event = createFetchErrorEvent(
      "Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/TvGdprCmpView.9fffdb6f.js. Error: undefined",
    );

    expect(isThirdPartyAnalyticsError(event)).toBe(true);
  });

  it("keeps unrelated application errors", () => {
    const event = {
      exception: {
        values: [
          {
            type: "Error",
            value: "Unable to load task",
          },
        ],
      },
    } as ErrorEvent;

    expect(isThirdPartyAnalyticsError(event)).toBe(false);
  });
});
