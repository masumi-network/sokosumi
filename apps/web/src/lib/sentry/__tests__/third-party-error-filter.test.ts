import type { ErrorEvent } from "@sentry/core";
import { describe, expect, it } from "vitest";

import {
  filterThirdPartyFetchError,
  shouldIgnoreThirdPartyFetchError,
} from "@/lib/sentry/third-party-error-filter";

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
            frames: filenames.map((filename) => ({
              filename,
              in_app: false,
            })),
          },
        },
      ],
    },
  };
}

describe("shouldIgnoreThirdPartyFetchError", () => {
  it("ignores LinkedIn Insight Tag fetch failures", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch (px.ads.linkedin.com)",
      ["app:///li.lms-analytics/insight.old.min.js"],
    );

    expect(shouldIgnoreThirdPartyFetchError(event)).toBe(true);
  });

  it("ignores Plausible analytics fetch failures", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch (plausible.io)",
      ["app:///js/script.file-downloads.hash.outbound-links.pageview-props.js"],
    );

    expect(shouldIgnoreThirdPartyFetchError(event)).toBe(true);
  });

  it("keeps server action fetch failures without a third-party host", () => {
    const event = createFetchErrorEvent("TypeError: Failed to fetch", [
      "node_modules/next/src/client/components/router-reducer/reducers/server-action-reducer.ts",
    ]);

    expect(shouldIgnoreThirdPartyFetchError(event)).toBe(false);
  });

  it("keeps first-party fetch failures in app source", () => {
    const event = createFetchErrorEvent("TypeError: Failed to fetch", [
      "webpack-internal:///(app-pages-browser)/./src/hooks/use-job-submission.ts",
    ]);

    expect(shouldIgnoreThirdPartyFetchError(event)).toBe(false);
  });
});

describe("filterThirdPartyFetchError", () => {
  it("returns null when the event should be ignored", () => {
    const event = createFetchErrorEvent(
      "TypeError: Failed to fetch (px.ads.linkedin.com)",
    );

    expect(filterThirdPartyFetchError(event, {})).toBeNull();
  });

  it("returns the event when it should be reported", () => {
    const event = createFetchErrorEvent("TypeError: Failed to fetch");

    expect(filterThirdPartyFetchError(event, {})).toBe(event);
  });
});
