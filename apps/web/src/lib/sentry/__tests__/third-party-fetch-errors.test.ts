import { describe, expect, it } from "vitest";

import {
  beforeSendClientEvent,
  isBareTransientNetworkFailure,
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

describe("isBareTransientNetworkFailure", () => {
  it("returns true for bare WebKit Load failed", () => {
    expect(isBareTransientNetworkFailure("TypeError: Load failed")).toBe(true);
    expect(isBareTransientNetworkFailure("Load failed")).toBe(true);
  });

  it("returns true for bare Failed to fetch", () => {
    expect(isBareTransientNetworkFailure("Failed to fetch")).toBe(true);
  });

  it("returns true for Firefox network errors", () => {
    expect(
      isBareTransientNetworkFailure(
        "NetworkError when attempting to fetch resource.",
      ),
    ).toBe(true);
  });

  it("returns false when a hostname suffix is present", () => {
    expect(
      isBareTransientNetworkFailure(
        "TypeError: Load failed (api.sokosumi.com)",
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

  it("drops bare transient network failures", () => {
    expect(
      beforeSendClientEvent(
        {
          type: undefined,
          exception: {
            values: [
              {
                type: "TypeError",
                value: "Load failed",
              },
            ],
          },
        },
        {},
      ),
    ).toBeNull();
  });

  it("drops Next.js router hook mismatch via beforeSend", () => {
    expect(
      beforeSendClientEvent(
        {
          type: undefined,
          exception: {
            values: [
              {
                value: "Rendered more hooks than during the previous render.",
              },
            ],
          },
        },
        {},
      ),
    ).toBeNull();
  });
});
