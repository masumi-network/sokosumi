import type { ErrorEvent } from "@sentry/core";
import { describe, expect, it } from "vitest";

import {
  filterClientSentryEvent,
  shouldDropClientSentryEvent,
} from "@/lib/sentry/client-error-filters";

function plausibleFetchFailureEvent(): ErrorEvent {
  return {
    message: "TypeError: Failed to fetch (plausible.io)",
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
              {
                filename: "app:///injectScriptAdjust.js",
                in_app: false,
              },
            ],
          },
        },
      ],
    },
  } as ErrorEvent;
}

describe("shouldDropClientSentryEvent", () => {
  it("drops plausible.io analytics fetch failures", () => {
    expect(shouldDropClientSentryEvent(plausibleFetchFailureEvent())).toBe(
      true,
    );
  });

  it("keeps first-party failed fetch errors", () => {
    const event = {
      message: "TypeError: Failed to fetch",
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch",
            stacktrace: {
              frames: [
                {
                  filename: "webpack-internal:///./src/hooks/use-job.ts",
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    } as ErrorEvent;

    expect(shouldDropClientSentryEvent(event)).toBe(false);
  });

  it("keeps errors that include both plausible and in-app frames", () => {
    const event = {
      message: "TypeError: Failed to fetch (plausible.io)",
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (plausible.io)",
            stacktrace: {
              frames: [
                {
                  filename: "webpack-internal:///./src/app/layout.tsx",
                  in_app: true,
                },
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

    expect(shouldDropClientSentryEvent(event)).toBe(false);
  });
});

describe("filterClientSentryEvent", () => {
  it("returns null when the event should be dropped", () => {
    expect(filterClientSentryEvent(plausibleFetchFailureEvent())).toBeNull();
  });

  it("returns the event when it should be kept", () => {
    const event = {
      message: "Error: Something broke in the app",
    } as ErrorEvent;

    expect(filterClientSentryEvent(event)).toBe(event);
  });
});
