import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { shouldDropThirdPartySentryEvent } from "@/lib/sentry/third-party-error-filters";

function createLinkedInFetchFailureEvent(): ErrorEvent {
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
                in_app: false,
              },
              {
                filename: "app:///frame_ant/frame_ant.js",
                function: "o",
                in_app: false,
              },
            ],
          },
        },
      ],
    },
  };
}

describe("shouldDropThirdPartySentryEvent", () => {
  it("drops LinkedIn Insight Tag fetch failures", () => {
    expect(
      shouldDropThirdPartySentryEvent(createLinkedInFetchFailureEvent()),
    ).toBe(true);
  });

  it("keeps first-party fetch failures", () => {
    const event: ErrorEvent = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch",
            stacktrace: {
              frames: [
                {
                  filename:
                    "webpack-internal:///./src/lib/clients/core.shared.ts",
                  function: "fetchTasks",
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    };

    expect(shouldDropThirdPartySentryEvent(event)).toBe(false);
  });

  it("keeps unrelated third-party errors without known signatures", () => {
    const event: ErrorEvent = {
      exception: {
        values: [
          {
            type: "ReferenceError",
            value: "foo is not defined",
            stacktrace: {
              frames: [
                {
                  filename: "app:///some-other-vendor/vendor.js",
                  function: "init",
                  in_app: false,
                },
              ],
            },
          },
        ],
      },
    };

    expect(shouldDropThirdPartySentryEvent(event)).toBe(false);
  });
});
