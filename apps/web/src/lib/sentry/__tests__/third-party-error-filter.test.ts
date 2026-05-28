import { describe, expect, it } from "vitest";

import {
  beforeSendDropThirdPartyAnalytics,
  isPlausibleAnalyticsStackTrace,
  isThirdPartyAnalyticsFetchFailure,
} from "@/lib/sentry/third-party-error-filter";

describe("isThirdPartyAnalyticsFetchFailure", () => {
  it("matches Chrome fetch failures for Plausible", () => {
    expect(
      isThirdPartyAnalyticsFetchFailure("Failed to fetch (plausible.io)"),
    ).toBe(true);
    expect(
      isThirdPartyAnalyticsFetchFailure(
        "TypeError: Failed to fetch (plausible.io)",
      ),
    ).toBe(true);
  });

  it("does not match first-party fetch failures", () => {
    expect(isThirdPartyAnalyticsFetchFailure("Failed to fetch")).toBe(false);
    expect(
      isThirdPartyAnalyticsFetchFailure(
        "Failed to fetch: Internal Server Error",
      ),
    ).toBe(false);
    expect(
      isThirdPartyAnalyticsFetchFailure("Failed to fetch job: Not Found"),
    ).toBe(false);
  });
});

describe("isPlausibleAnalyticsStackTrace", () => {
  it("matches stacks from Plausible script and browser extensions only", () => {
    expect(
      isPlausibleAnalyticsStackTrace({
        exception: {
          values: [
            {
              stacktrace: {
                frames: [
                  {
                    filename:
                      "app:///js/script.file-downloads.hash.outbound-links.js",
                  },
                  { filename: "app:///frame_ant/frame_ant.js" },
                  {
                    filename:
                      "node_modules/.pnpm/@sentry+core@10.54.0/node_modules/@sentry/core/src/instrument/fetch.ts",
                  },
                ],
              },
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("does not match stacks that include application code", () => {
    expect(
      isPlausibleAnalyticsStackTrace({
        exception: {
          values: [
            {
              stacktrace: {
                frames: [
                  {
                    filename:
                      "app:///js/script.file-downloads.hash.outbound-links.js",
                  },
                  {
                    filename:
                      "webpack-internal:///(app-pages-browser)/./src/hooks/use-job-submission.ts",
                    in_app: true,
                  },
                ],
              },
            },
          ],
        },
      }),
    ).toBe(false);
  });
});

describe("beforeSendDropThirdPartyAnalytics", () => {
  it("drops Plausible fetch failures by message", () => {
    const result = beforeSendDropThirdPartyAnalytics(
      {
        exception: {
          values: [{ value: "Failed to fetch (plausible.io)" }],
        },
      },
      { originalException: new TypeError("Failed to fetch (plausible.io)") },
    );

    expect(result).toBeNull();
  });

  it("passes through unrelated application errors", () => {
    const event = {
      exception: {
        values: [{ value: "Failed to fetch job: Internal Server Error" }],
      },
    };

    expect(
      beforeSendDropThirdPartyAnalytics(event, {
        originalException: new Error(
          "Failed to fetch job: Internal Server Error",
        ),
      }),
    ).toBe(event);
  });
});
