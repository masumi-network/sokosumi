import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { shouldDropClientSentryEvent } from "@/lib/sentry/client-error-filters";

function linkedInPixelEvent(): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Failed to fetch (px.ads.linkedin.com)",
          stacktrace: {
            frames: [
              {
                filename: "app:///li.lms-analytics/insight.old.min.js",
                function: "Gt",
              },
              {
                filename: "app:///frame_ant/frame_ant.js",
                function: "o",
              },
            ],
          },
        },
      ],
    },
  };
}

describe("shouldDropClientSentryEvent", () => {
  it("drops LinkedIn Insight Tag fetch failures from GTM", () => {
    expect(shouldDropClientSentryEvent(linkedInPixelEvent())).toBe(true);
  });

  it("drops when only the error message matches", () => {
    expect(
      shouldDropClientSentryEvent({
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

  it("keeps first-party fetch failures", () => {
    expect(
      shouldDropClientSentryEvent({
        exception: {
          values: [
            {
              type: "TypeError",
              value: "Failed to fetch",
              stacktrace: {
                frames: [
                  {
                    filename:
                      "webpack-internal:///./src/lib/clients/core.client.ts",
                    function: "fetchJobs",
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
