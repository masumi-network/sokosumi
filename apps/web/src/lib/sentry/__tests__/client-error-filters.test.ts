import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  beforeSendClientError,
  isThirdPartyAnalyticsFetchNoise,
} from "@/lib/sentry/client-error-filters";

function createPlausibleFetchErrorEvent(): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Failed to fetch (plausible.io)",
          stacktrace: {
            frames: [
              {
                filename:
                  "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
                in_app: false,
              },
            ],
          },
        },
      ],
    },
  } as ErrorEvent;
}

describe("isThirdPartyAnalyticsFetchNoise", () => {
  it("returns true for plausible.io failed fetch errors", () => {
    expect(
      isThirdPartyAnalyticsFetchNoise(createPlausibleFetchErrorEvent()),
    ).toBe(true);
  });

  it("returns true when stack frames reference plausible scripts", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch",
            stacktrace: {
              frames: [
                {
                  filename: "https://plausible.io/js/script.js",
                  in_app: false,
                },
              ],
            },
          },
        ],
      },
    } as ErrorEvent;

    expect(isThirdPartyAnalyticsFetchNoise(event)).toBe(true);
  });

  it("returns false for application fetch failures", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch",
            stacktrace: {
              frames: [
                {
                  filename:
                    "webpack-internal:///src/lib/clients/core.client.ts",
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    } as ErrorEvent;

    expect(isThirdPartyAnalyticsFetchNoise(event)).toBe(false);
  });

  it("returns false for non-fetch application errors", () => {
    const event = {
      exception: {
        values: [
          {
            type: "Error",
            value: "Cannot read properties of undefined",
          },
        ],
      },
    } as ErrorEvent;

    expect(isThirdPartyAnalyticsFetchNoise(event)).toBe(false);
  });
});

describe("beforeSendClientError", () => {
  it("drops third-party analytics fetch noise", () => {
    expect(beforeSendClientError(createPlausibleFetchErrorEvent())).toBeNull();
  });

  it("passes through application errors", () => {
    const event = {
      exception: {
        values: [
          {
            type: "Error",
            value: "Something broke in our code",
          },
        ],
      },
    } as ErrorEvent;

    expect(beforeSendClientError(event)).toBe(event);
  });
});
