import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  beforeSendFilterThirdPartyErrors,
  isThirdPartyAnalyticsFetchError,
} from "@/lib/sentry/filter-third-party-errors";

function createFetchErrorEvent(
  message: string,
  stackFilenames: string[] = [],
): ErrorEvent {
  return {
    type: "error",
    exception: {
      values: [
        {
          type: "TypeError",
          value: message,
          stacktrace: {
            frames: stackFilenames.map((filename) => ({
              filename,
            })),
          },
        },
      ],
    },
  };
}

describe("isThirdPartyAnalyticsFetchError", () => {
  it("filters LinkedIn Insight Tag fetch failures (SOKOSUMI-P2)", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch (px.ads.linkedin.com)",
      ["app:///li.lms-analytics/insight.old.min.js"],
    );

    expect(isThirdPartyAnalyticsFetchError(event)).toBe(true);
    expect(beforeSendFilterThirdPartyErrors(event)).toBeNull();
  });

  it("filters plausible.io fetch failures", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch (plausible.io)",
      ["https://plausible.io/js/script.js"],
    );

    expect(isThirdPartyAnalyticsFetchError(event)).toBe(true);
  });

  it("filters Usercentrics dynamic import failures", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/3.121.1/WebSdk.lib.js. Error: undefined",
      ["https://web.cmp.usercentrics.eu/ui/loader.js"],
    );

    expect(isThirdPartyAnalyticsFetchError(event)).toBe(true);
  });

  it("does not filter first-party API fetch failures", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch (api.sokosumi.com)",
      ["webpack:///./src/lib/clients/core.shared.ts"],
    );

    expect(isThirdPartyAnalyticsFetchError(event)).toBe(false);
    expect(beforeSendFilterThirdPartyErrors(event)).toBe(event);
  });

  it("does not filter bare Failed to fetch when stack includes app code", () => {
    const event = createFetchErrorEvent("TypeError: Failed to fetch", [
      "webpack:///./src/hooks/use-job-submission.ts",
    ]);

    expect(isThirdPartyAnalyticsFetchError(event)).toBe(false);
  });

  it("filters bare Failed to fetch when stack is third-party only", () => {
    const event = createFetchErrorEvent("TypeError: Failed to fetch", [
      "app:///li.lms-analytics/insight.old.min.js",
      "app:///frame_ant/frame_ant.js",
    ]);

    expect(isThirdPartyAnalyticsFetchError(event)).toBe(true);
  });
});
