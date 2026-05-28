import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import {
  sentryClientBeforeSend,
  shouldDropSentryClientNoise,
} from "@/lib/sentry/client-noise-filter";

function linkedInPixelFetchEvent(): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Failed to fetch (px.ads.linkedin.com)",
          stacktrace: {
            frames: [
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

function appNetworkFailureEvent(): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Failed to fetch",
          stacktrace: {
            frames: [
              {
                filename:
                  "webpack-internal:///./src/hooks/use-job-submission.ts",
                function: "startJob",
                in_app: true,
              },
            ],
          },
        },
      ],
    },
  };
}

describe("shouldDropSentryClientNoise", () => {
  it("drops LinkedIn ad pixel fetch failures from extension-injected scripts", () => {
    expect(shouldDropSentryClientNoise(linkedInPixelFetchEvent())).toBe(true);
  });

  it("keeps generic app fetch failures", () => {
    expect(shouldDropSentryClientNoise(appNetworkFailureEvent())).toBe(false);
  });

  it("drops events when every stack frame is from an external script", () => {
    const event: ErrorEvent = {
      exception: {
        values: [
          {
            type: "Error",
            value: "extension failure",
            stacktrace: {
              frames: [
                {
                  filename: "chrome-extension://abc/content.js",
                },
              ],
            },
          },
        ],
      },
    };

    expect(shouldDropSentryClientNoise(event)).toBe(true);
  });
});

describe("sentryClientBeforeSend", () => {
  it("returns null for dropped noise events", () => {
    expect(sentryClientBeforeSend(linkedInPixelFetchEvent(), {})).toBeNull();
  });

  it("returns the event for real application failures", () => {
    const event = appNetworkFailureEvent();
    expect(sentryClientBeforeSend(event, {})).toBe(event);
  });
});
