import { describe, expect, it } from "vitest";

import {
  beforeSendClientEvent,
  isBareTransientNetworkFailure,
  isThirdPartyAnalyticsFetchFailure,
  isThirdPartyDynamicImportFailure,
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
  it("returns true for bare Safari Load failed messages", () => {
    expect(isBareTransientNetworkFailure("TypeError: Load failed")).toBe(true);
    expect(isBareTransientNetworkFailure("Load failed")).toBe(true);
  });

  it("returns true for bare Failed to fetch messages", () => {
    expect(isBareTransientNetworkFailure("Failed to fetch")).toBe(true);
  });

  it("returns false when a hostname is present", () => {
    expect(
      isBareTransientNetworkFailure(
        "TypeError: Load failed (api.sokosumi.com)",
      ),
    ).toBe(false);
  });
});

describe("isThirdPartyDynamicImportFailure", () => {
  it("returns true for Usercentrics chunk import failures", () => {
    expect(
      isThirdPartyDynamicImportFailure(
        "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/4.3.0/WebSdk.lib.44b003b5.js. Error: undefined",
      ),
    ).toBe(true);
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

  it("drops bare Safari network failures", () => {
    expect(
      beforeSendClientEvent(
        {
          type: undefined,
          exception: {
            values: [{ value: "TypeError: Load failed" }],
          },
        },
        {},
      ),
    ).toBeNull();
  });

  it("drops Next.js router hook mismatch noise", () => {
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

  it("drops masked production RSC render rejections", () => {
    expect(
      beforeSendClientEvent(
        {
          type: undefined,
          exception: {
            values: [
              {
                value:
                  "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.",
              },
            ],
          },
        },
        {},
      ),
    ).toBeNull();
  });

  it("drops Cardano wallet extension failures", () => {
    expect(
      beforeSendClientEvent(
        {
          type: undefined,
          exception: {
            values: [
              {
                value:
                  "Cannot read properties of undefined (reading 'REQUEST_ID')",
                stacktrace: {
                  frames: [{ filename: "app:///js/cardano.bundle.js" }],
                },
              },
            ],
          },
        },
        {},
      ),
    ).toBeNull();
  });

  it("drops WebKit DOM mutation NotFoundError noise", () => {
    expect(
      beforeSendClientEvent(
        {
          type: undefined,
          exception: {
            values: [
              {
                type: "NotFoundError",
                value: "The object can not be found here.",
              },
            ],
          },
        },
        {},
      ),
    ).toBeNull();
  });

  it("drops in-app browser webkit bridge failures", () => {
    expect(
      beforeSendClientEvent(
        {
          type: undefined,
          exception: {
            values: [
              {
                type: "TypeError",
                value:
                  "undefined is not an object (evaluating 'window.webkit.messageHandlers')",
              },
            ],
          },
        },
        {},
      ),
    ).toBeNull();
  });

  it("drops transient stream connection closures", () => {
    expect(
      beforeSendClientEvent(
        {
          type: undefined,
          exception: {
            values: [{ type: "Error", value: "Connection closed." }],
          },
        },
        {},
      ),
    ).toBeNull();
  });

  it("drops React DevTools hook.js extension failures", () => {
    expect(
      beforeSendClientEvent(
        {
          type: undefined,
          exception: {
            values: [
              {
                type: "TypeError",
                value: "Cannot read properties of undefined (reading 'id')",
                stacktrace: {
                  frames: [{ filename: "app:///hook.js" }],
                },
              },
            ],
          },
        },
        {},
      ),
    ).toBeNull();
  });

  it("drops generic coworker chat stream surface errors", () => {
    expect(
      beforeSendClientEvent(
        {
          type: undefined,
          transaction: "/chat",
          exception: {
            values: [{ type: "Error", value: "An error occurred." }],
          },
        },
        {},
      ),
    ).toBeNull();
  });

  it("drops Next.js router hook mismatch noise from hint fallback", () => {
    expect(
      beforeSendClientEvent(
        {
          type: undefined,
          exception: {
            values: [{ type: "Error", value: "" }],
          },
        },
        {
          originalException: new Error(
            "Rendered more hooks than during the previous render.",
          ),
        },
      ),
    ).toBeNull();
  });
});
