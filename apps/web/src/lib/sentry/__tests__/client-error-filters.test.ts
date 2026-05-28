import { describe, expect, it } from "vitest";

import {
  shouldDropThirdPartyAnalyticsError,
  THIRD_PARTY_ANALYTICS_DENY_URLS,
  THIRD_PARTY_ANALYTICS_IGNORE_ERRORS,
} from "@/lib/sentry/client-error-filters";

describe("THIRD_PARTY_ANALYTICS_IGNORE_ERRORS", () => {
  it("matches linkedin and plausible fetch failures", () => {
    const patterns = THIRD_PARTY_ANALYTICS_IGNORE_ERRORS.filter(
      (pattern): pattern is RegExp => pattern instanceof RegExp,
    );

    expect(
      patterns.some((pattern) =>
        pattern.test("TypeError: Failed to fetch (px.ads.linkedin.com)"),
      ),
    ).toBe(true);
    expect(
      patterns.some((pattern) =>
        pattern.test("TypeError: Failed to fetch (plausible.io)"),
      ),
    ).toBe(true);
    expect(
      patterns.some((pattern) => pattern.test("TypeError: Failed to fetch")),
    ).toBe(false);
  });
});

describe("THIRD_PARTY_ANALYTICS_DENY_URLS", () => {
  it("matches linkedin insight and plausible script urls", () => {
    expect(
      THIRD_PARTY_ANALYTICS_DENY_URLS.some((pattern) =>
        pattern instanceof RegExp
          ? pattern.test("app:///li.lms-analytics/insight.old.min.js")
          : false,
      ),
    ).toBe(true);
    expect(
      THIRD_PARTY_ANALYTICS_DENY_URLS.some((pattern) =>
        pattern instanceof RegExp
          ? pattern.test("https://plausible.io/js/script.js")
          : false,
      ),
    ).toBe(true);
  });
});

describe("shouldDropThirdPartyAnalyticsError", () => {
  it("drops linkedin insight tag fetch failures", () => {
    expect(
      shouldDropThirdPartyAnalyticsError({
        exception: {
          values: [
            {
              type: "TypeError",
              value: "Failed to fetch (px.ads.linkedin.com)",
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("drops plausible analytics fetch failures", () => {
    expect(
      shouldDropThirdPartyAnalyticsError({
        message: "TypeError: Failed to fetch (plausible.io)",
      }),
    ).toBe(true);
  });

  it("keeps generic failed to fetch errors from app code", () => {
    expect(
      shouldDropThirdPartyAnalyticsError({
        exception: {
          values: [
            {
              type: "TypeError",
              value: "Failed to fetch",
              stacktrace: {
                frames: [
                  {
                    filename:
                      "node_modules/next/src/client/components/router-reducer/reducers/server-action-reducer.ts",
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

  it("drops errors when stack frames are only third-party analytics scripts", () => {
    expect(
      shouldDropThirdPartyAnalyticsError({
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
                    in_app: true,
                  },
                  {
                    filename: "https://plausible.io/js/script.js",
                    in_app: true,
                  },
                ],
              },
            },
          ],
        },
      }),
    ).toBe(true);
  });
});
