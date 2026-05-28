import type { ErrorEvent } from "@sentry/core";
import { describe, expect, it } from "vitest";

import {
  getFailedFetchHost,
  isKnownThirdPartyFetchHost,
  isThirdPartyAnalyticsFetchError,
  shouldDropThirdPartyClientError,
} from "@/lib/sentry/third-party-error-filter";

function makeFetchErrorEvent(message: string, filenames: string[]): ErrorEvent {
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
  } as ErrorEvent;
}

describe("getFailedFetchHost", () => {
  it("extracts host from Failed to fetch errors", () => {
    expect(
      getFailedFetchHost("TypeError: Failed to fetch (px.ads.linkedin.com)"),
    ).toBe("px.ads.linkedin.com");
  });

  it("returns null for unrelated messages", () => {
    expect(getFailedFetchHost("TypeError: Failed to fetch")).toBeNull();
  });
});

describe("isKnownThirdPartyFetchHost", () => {
  it("matches linkedin insight pixel host", () => {
    expect(isKnownThirdPartyFetchHost("px.ads.linkedin.com")).toBe(true);
  });

  it("does not match first-party API host", () => {
    expect(isKnownThirdPartyFetchHost("api.sokosumi.com")).toBe(false);
  });
});

describe("isThirdPartyAnalyticsFetchError", () => {
  it("drops linkedin insight tag fetch failures (SOKOSUMI-P2)", () => {
    const event = makeFetchErrorEvent(
      "TypeError: Failed to fetch (px.ads.linkedin.com)",
      [
        "app:///li.lms-analytics/insight.old.min.js",
        "app:///frame_ant/frame_ant.js",
      ],
    );

    expect(isThirdPartyAnalyticsFetchError(event)).toBe(true);
    expect(shouldDropThirdPartyClientError(event)).toBe(true);
  });

  it("drops plausible analytics fetch failures", () => {
    const event = makeFetchErrorEvent(
      "TypeError: Failed to fetch (plausible.io)",
      ["https://plausible.io/js/script.js"],
    );

    expect(isThirdPartyAnalyticsFetchError(event)).toBe(true);
  });

  it("drops usercentrics dynamic import failures", () => {
    const event = makeFetchErrorEvent(
      "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/3.121.1/WebSdk.lib.44b003b5.js. Error: undefined",
      [],
    );

    expect(isThirdPartyAnalyticsFetchError(event)).toBe(true);
  });

  it("keeps first-party API fetch failures", () => {
    const event = makeFetchErrorEvent(
      "TypeError: Failed to fetch (api.sokosumi.com)",
      ["webpack-internal:///./src/lib/clients/core.shared.ts"],
    );

    expect(isThirdPartyAnalyticsFetchError(event)).toBe(false);
  });
});
