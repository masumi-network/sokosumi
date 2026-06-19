import { describe, expect, it } from "vitest";

import {
  beforeSendClientEvent,
  isThirdPartyAnalyticsFetchFailure,
  isTransientFirstPartyApiFetchFailure,
  thirdPartyAnalyticsIgnoreErrors,
} from "@/lib/sentry/third-party-fetch-errors";

describe("isThirdPartyAnalyticsFetchFailure", () => {
  it("returns true for Plausible fetch failures", () => {
    expect(
      isThirdPartyAnalyticsFetchFailure(
        "TypeError: Failed to fetch (plausible.io)",
      ),
    ).toBe(true);
  });

  it("returns true for exception values without the TypeError prefix", () => {
    // Sentry stores the type separately, so real events arrive in this shape.
    expect(
      isThirdPartyAnalyticsFetchFailure("Failed to fetch (plausible.io)"),
    ).toBe(true);
  });

  it("returns true for LinkedIn pixel fetch failures", () => {
    expect(
      isThirdPartyAnalyticsFetchFailure(
        "TypeError: Failed to fetch (px.ads.linkedin.com)",
      ),
    ).toBe(true);
  });

  it("returns false for generic fetch failures without a host", () => {
    expect(
      isThirdPartyAnalyticsFetchFailure("TypeError: Failed to fetch"),
    ).toBe(false);
  });

  it("returns false for first-party API fetch failures", () => {
    expect(
      isThirdPartyAnalyticsFetchFailure(
        "TypeError: Failed to fetch (app.sokosumi.com)",
      ),
    ).toBe(false);
  });
});

describe("isTransientFirstPartyApiFetchFailure", () => {
  it("returns true for WebKit Load failed against Core API", () => {
    expect(
      isTransientFirstPartyApiFetchFailure(
        "TypeError: Load failed (api.sokosumi.com)",
      ),
    ).toBe(true);
  });

  it("returns true for Chromium Failed to fetch against Core API", () => {
    expect(
      isTransientFirstPartyApiFetchFailure(
        "Failed to fetch (api.preprod.sokosumi.com)",
      ),
    ).toBe(true);
  });

  it("returns false for unrelated hosts", () => {
    expect(
      isTransientFirstPartyApiFetchFailure(
        "TypeError: Load failed (example.com)",
      ),
    ).toBe(false);
  });
});

describe("thirdPartyAnalyticsIgnoreErrors", () => {
  function matchesIgnoreErrors(message: string): boolean {
    return thirdPartyAnalyticsIgnoreErrors.some((pattern) =>
      pattern.test(message),
    );
  }

  it("matches the Chromium/Firefox clarity message", () => {
    expect(matchesIgnoreErrors("window.clarity is not a function")).toBe(true);
  });

  it("matches the WebKit clarity message", () => {
    expect(
      matchesIgnoreErrors(
        "window.clarity is not a function. (In 'window.clarity(\"event\",\"sign_up\")', 'window.clarity' is undefined)",
      ),
    ).toBe(true);
  });

  it("does not match unrelated not-a-function errors", () => {
    expect(matchesIgnoreErrors("foo.bar is not a function")).toBe(false);
  });
});

describe("beforeSendClientEvent", () => {
  it("drops third-party analytics fetch error events", () => {
    const result = beforeSendClientEvent(
      {
        type: undefined,
        exception: {
          values: [
            {
              value: "TypeError: Failed to fetch (plausible.io)",
            },
          ],
        },
      },
      {},
    );

    expect(result).toBeNull();
  });

  it("drops events whose exception value lacks the TypeError prefix", () => {
    const result = beforeSendClientEvent(
      {
        type: undefined,
        exception: {
          values: [
            {
              type: "TypeError",
              value: "Failed to fetch (plausible.io)",
            },
          ],
        },
      },
      {},
    );

    expect(result).toBeNull();
  });

  it("keeps application fetch error events", () => {
    const event = {
      type: undefined,
      exception: {
        values: [
          {
            value: "TypeError: Failed to fetch (app.sokosumi.com)",
          },
        ],
      },
    };

    expect(beforeSendClientEvent(event, {})).toBe(event);
  });

  it("drops transient Core API network failures", () => {
    expect(
      beforeSendClientEvent(
        {
          type: undefined,
          exception: {
            values: [
              {
                value: "TypeError: Load failed (api.sokosumi.com)",
              },
            ],
          },
        },
        {},
      ),
    ).toBeNull();
  });
});
