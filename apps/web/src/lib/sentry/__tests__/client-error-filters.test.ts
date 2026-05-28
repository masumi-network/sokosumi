import { describe, expect, it } from "vitest";

import {
  beforeSendClientError,
  isThirdPartyAnalyticsFetchMessage,
  shouldIgnoreClientError,
} from "@/lib/sentry/client-error-filters";

describe("isThirdPartyAnalyticsFetchMessage", () => {
  it("matches plausible.io fetch failures", () => {
    expect(
      isThirdPartyAnalyticsFetchMessage(
        "TypeError: Failed to fetch (plausible.io)",
      ),
    ).toBe(true);
  });

  it("matches nested analytics hostnames", () => {
    expect(
      isThirdPartyAnalyticsFetchMessage(
        "TypeError: Failed to fetch (region1.google-analytics.com)",
      ),
    ).toBe(true);
  });

  it("does not match first-party API hosts", () => {
    expect(
      isThirdPartyAnalyticsFetchMessage(
        "TypeError: Failed to fetch (api.sokosumi.com)",
      ),
    ).toBe(false);
    expect(
      isThirdPartyAnalyticsFetchMessage(
        "TypeError: Failed to fetch (app.sokosumi.com)",
      ),
    ).toBe(false);
  });

  it("does not match generic failed to fetch messages", () => {
    expect(
      isThirdPartyAnalyticsFetchMessage("TypeError: Failed to fetch"),
    ).toBe(false);
  });
});

describe("shouldIgnoreClientError", () => {
  it("ignores plausible analytics unhandled rejections", () => {
    expect(
      shouldIgnoreClientError(
        {
          exception: {
            values: [
              {
                value: "TypeError: Failed to fetch (plausible.io)",
              },
            ],
          },
        },
        {
          originalException: new TypeError("Failed to fetch (plausible.io)"),
        },
      ),
    ).toBe(true);
  });

  it("ignores usercentrics dynamic import failures", () => {
    const message =
      "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/3.121.1/WebSdk.lib.44b003b5.js. Error: undefined";

    expect(
      shouldIgnoreClientError(
        {
          exception: {
            values: [{ value: message }],
          },
        },
        { originalException: new TypeError(message) },
      ),
    ).toBe(true);
  });

  it("keeps first-party API fetch failures", () => {
    expect(
      shouldIgnoreClientError(
        {
          exception: {
            values: [
              {
                value: "TypeError: Failed to fetch (api.sokosumi.com)",
              },
            ],
          },
        },
        {
          originalException: new TypeError(
            "Failed to fetch (api.sokosumi.com)",
          ),
        },
      ),
    ).toBe(false);
  });
});

describe("beforeSendClientError", () => {
  it("drops ignored events", () => {
    expect(
      beforeSendClientError(
        {
          exception: {
            values: [
              {
                value: "TypeError: Failed to fetch (plausible.io)",
              },
            ],
          },
        },
        {
          originalException: new TypeError("Failed to fetch (plausible.io)"),
        },
      ),
    ).toBeNull();
  });

  it("passes through real application errors", () => {
    const event = {
      exception: {
        values: [{ value: "TypeError: Failed to fetch (api.sokosumi.com)" }],
      },
    };

    expect(
      beforeSendClientError(event, {
        originalException: new TypeError("Failed to fetch (api.sokosumi.com)"),
      }),
    ).toBe(event);
  });
});
