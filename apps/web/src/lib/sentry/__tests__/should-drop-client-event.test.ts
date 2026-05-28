import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { shouldDropClientSentryEvent } from "@/lib/sentry/should-drop-client-event";

function createEvent(partial: Partial<ErrorEvent>): ErrorEvent {
  return {
    type: "error",
    ...partial,
  } as ErrorEvent;
}

describe("shouldDropClientSentryEvent", () => {
  it("drops LinkedIn Insight Tag fetch failures", () => {
    const event = createEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (px.ads.linkedin.com)",
            stacktrace: {
              frames: [
                {
                  filename: "app:///li.lms-analytics/insight.old.min.js",
                  in_app: false,
                },
              ],
            },
          },
        ],
      },
    });

    expect(shouldDropClientSentryEvent(event)).toBe(true);
  });

  it("drops Plausible analytics fetch failures", () => {
    const event = createEvent({
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
    });

    expect(shouldDropClientSentryEvent(event)).toBe(true);
  });

  it("keeps server action fetch failures", () => {
    const event = createEvent({
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
    });

    expect(shouldDropClientSentryEvent(event)).toBe(false);
  });

  it("keeps generic fetch failures with in-app stack frames", () => {
    const event = createEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch",
            stacktrace: {
              frames: [
                {
                  filename: "webpack:///src/lib/clients/core.browser.client.ts",
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    });

    expect(shouldDropClientSentryEvent(event)).toBe(false);
  });
});
