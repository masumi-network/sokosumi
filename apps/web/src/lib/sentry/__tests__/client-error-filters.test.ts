import { describe, expect, it } from "vitest";

import {
  getThirdPartyFetchFailureHost,
  isIgnoredThirdPartyFetchFailureHost,
  isThirdPartyAnalyticsFetchFailure,
  shouldDropClientSentryEvent,
} from "@/lib/sentry/client-error-filters";

describe("client-error-filters", () => {
  describe("getThirdPartyFetchFailureHost", () => {
    it("extracts host from Chrome fetch failure messages", () => {
      expect(
        getThirdPartyFetchFailureHost("Failed to fetch (plausible.io)"),
      ).toBe("plausible.io");
    });

    it("returns undefined for generic fetch failures", () => {
      expect(getThirdPartyFetchFailureHost("Failed to fetch")).toBeUndefined();
    });
  });

  describe("isIgnoredThirdPartyFetchFailureHost", () => {
    it("matches known marketing hosts and subdomains", () => {
      expect(isIgnoredThirdPartyFetchFailureHost("plausible.io")).toBe(true);
      expect(isIgnoredThirdPartyFetchFailureHost("sub.plausible.io")).toBe(
        true,
      );
      expect(isIgnoredThirdPartyFetchFailureHost("px.ads.linkedin.com")).toBe(
        true,
      );
    });

    it("does not match first-party API hosts", () => {
      expect(isIgnoredThirdPartyFetchFailureHost("app.sokosumi.com")).toBe(
        false,
      );
    });
  });

  describe("isThirdPartyAnalyticsFetchFailure", () => {
    it("detects plausible.io fetch rejections", () => {
      expect(
        isThirdPartyAnalyticsFetchFailure(
          new TypeError("Failed to fetch (plausible.io)"),
        ),
      ).toBe(true);
    });

    it("ignores non-TypeError failures", () => {
      expect(
        isThirdPartyAnalyticsFetchFailure(new Error("Failed to fetch")),
      ).toBe(false);
    });

    it("does not filter generic Failed to fetch without host", () => {
      expect(
        isThirdPartyAnalyticsFetchFailure(new TypeError("Failed to fetch")),
      ).toBe(false);
    });
  });

  describe("shouldDropClientSentryEvent", () => {
    it("drops plausible.io errors by message", () => {
      expect(
        shouldDropClientSentryEvent(
          { exception: { values: [] } },
          {
            originalException: new TypeError("Failed to fetch (plausible.io)"),
          },
        ),
      ).toBe(true);
    });

    it("drops linkedin ads fetch errors", () => {
      expect(
        shouldDropClientSentryEvent(
          { exception: { values: [] } },
          {
            originalException: new TypeError(
              "Failed to fetch (px.ads.linkedin.com)",
            ),
          },
        ),
      ).toBe(true);
    });

    it("keeps server action fetch failures", () => {
      expect(
        shouldDropClientSentryEvent(
          {
            exception: {
              values: [
                {
                  stacktrace: {
                    frames: [
                      {
                        filename:
                          "node_modules/next/src/client/components/router-reducer/reducers/server-action-reducer.ts",
                      },
                    ],
                  },
                },
              ],
            },
          },
          { originalException: new TypeError("Failed to fetch") },
        ),
      ).toBe(false);
    });

    it("drops generic Failed to fetch when stack is third-party script", () => {
      expect(
        shouldDropClientSentryEvent(
          {
            exception: {
              values: [
                {
                  stacktrace: {
                    frames: [
                      {
                        filename:
                          "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
                      },
                    ],
                  },
                },
              ],
            },
          },
          { originalException: new TypeError("Failed to fetch") },
        ),
      ).toBe(true);
    });
  });
});
