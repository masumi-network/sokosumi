import { describe, expect, it } from "vitest";

import {
  isThirdPartyAnalyticsFetchNoise,
  thirdPartyAnalyticsBeforeSend,
} from "@/lib/sentry/third-party-analytics-filters";

function buildEvent(params: {
  message?: string;
  frames?: Array<{ filename?: string }>;
}): Parameters<typeof isThirdPartyAnalyticsFetchNoise>[0] {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: params.message,
          stacktrace: params.frames
            ? {
                frames: params.frames.map((frame) => ({
                  filename: frame.filename,
                  in_app: false,
                })),
              }
            : undefined,
        },
      ],
    },
  };
}

describe("isThirdPartyAnalyticsFetchNoise", () => {
  it("drops LinkedIn Insight Tag fetch failures", () => {
    expect(
      isThirdPartyAnalyticsFetchNoise(
        buildEvent({
          message: "Failed to fetch (px.ads.linkedin.com)",
          frames: [{ filename: "app:///li.lms-analytics/insight.old.min.js" }],
        }),
      ),
    ).toBe(true);
  });

  it("drops Plausible fetch failures", () => {
    expect(
      isThirdPartyAnalyticsFetchNoise(
        buildEvent({
          message: "Failed to fetch (plausible.io)",
          frames: [
            {
              filename:
                "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("keeps generic failed fetch errors from app server actions", () => {
    expect(
      isThirdPartyAnalyticsFetchNoise(
        buildEvent({
          message: "Failed to fetch",
          frames: [
            {
              filename:
                "node_modules/.pnpm/next@16.2.6/node_modules/next/src/client/components/router-reducer/reducers/server-action-reducer.ts",
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("keeps failed fetch errors without a known analytics host", () => {
    expect(
      isThirdPartyAnalyticsFetchNoise(
        buildEvent({
          message: "Failed to fetch",
          frames: [{ filename: "app:///src/lib/clients/core.shared.ts" }],
        }),
      ),
    ).toBe(false);
  });
});

describe("thirdPartyAnalyticsBeforeSend", () => {
  it("returns null for third-party analytics noise", () => {
    expect(
      thirdPartyAnalyticsBeforeSend(
        buildEvent({ message: "Failed to fetch (plausible.io)" }),
        {},
      ),
    ).toBeNull();
  });

  it("returns the event for real application errors", () => {
    const event = buildEvent({ message: "Failed to fetch" });
    expect(thirdPartyAnalyticsBeforeSend(event, {})).toBe(event);
  });
});
