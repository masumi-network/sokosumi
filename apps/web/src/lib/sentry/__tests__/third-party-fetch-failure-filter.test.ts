import { describe, expect, it } from "vitest";

import {
  shouldDropThirdPartyFetchFailure,
  thirdPartyFetchFailureIgnoreErrors,
} from "@/lib/sentry/third-party-fetch-failure-filter";

function createErrorEvent(message: string, filenames: string[] = []) {
  return {
    message,
    exception: {
      values: [
        {
          value: message,
          stacktrace: {
            frames: filenames.map((filename) => ({ filename })),
          },
        },
      ],
    },
  };
}

describe("shouldDropThirdPartyFetchFailure", () => {
  it("drops plausible.io fetch failures", () => {
    const event = createErrorEvent("TypeError: Failed to fetch (plausible.io)");
    expect(shouldDropThirdPartyFetchFailure(event)).toBe(true);
  });

  it("drops plausible script stack frames without domain in message", () => {
    const event = createErrorEvent("TypeError: Failed to fetch", [
      "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
    ]);
    expect(shouldDropThirdPartyFetchFailure(event)).toBe(true);
  });

  it("keeps failures to the Sokosumi app origin", () => {
    const event = createErrorEvent(
      "TypeError: Failed to fetch (app.sokosumi.com)",
    );
    expect(shouldDropThirdPartyFetchFailure(event)).toBe(false);
  });

  it("keeps generic fetch failures without third-party markers", () => {
    const event = createErrorEvent("TypeError: Failed to fetch");
    expect(shouldDropThirdPartyFetchFailure(event)).toBe(false);
  });

  it("drops usercentrics dynamic import failures", () => {
    const event = createErrorEvent(
      "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/TvGdprCmpView.a460128e.js. Error: undefined",
    );
    expect(shouldDropThirdPartyFetchFailure(event)).toBe(true);
  });
});

describe("thirdPartyFetchFailureIgnoreErrors", () => {
  it("matches plausible.io signature", () => {
    const pattern = thirdPartyFetchFailureIgnoreErrors[0];
    expect(pattern).toBeInstanceOf(RegExp);
    expect(
      (pattern as RegExp).test("TypeError: Failed to fetch (plausible.io)"),
    ).toBe(true);
  });
});
