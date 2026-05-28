import type { ErrorEvent } from "@sentry/core";
import { describe, expect, it } from "vitest";

import {
  filterClientSentryEvent,
  shouldDropClientSentryEvent,
} from "@/lib/sentry/client-event-filters";

function createEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    event_id: "test-event",
    platform: "javascript",
    ...overrides,
  };
}

describe("shouldDropClientSentryEvent", () => {
  it("drops plausible fetch failures caused by browser extensions", () => {
    const event = createEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (plausible.io)",
            stacktrace: {
              frames: [
                {
                  filename: "app:///injectScriptAdjust.js",
                  function: "doDefault",
                },
                {
                  filename:
                    "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
                  function: "p",
                },
              ],
            },
          },
        ],
      },
    });

    expect(shouldDropClientSentryEvent(event)).toBe(true);
    expect(filterClientSentryEvent(event)).toBeNull();
  });

  it("drops analytics fetch failures without app stack frames", () => {
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
                    "https://plausible.io/js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
                  function: "send",
                },
              ],
            },
          },
        ],
      },
    });

    expect(shouldDropClientSentryEvent(event)).toBe(true);
  });

  it("keeps app fetch failures even when the message mentions fetch", () => {
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
                    "webpack-internal:///./src/lib/clients/core.shared.ts",
                  function: "fetchTasks",
                },
              ],
            },
          },
        ],
      },
    });

    expect(shouldDropClientSentryEvent(event)).toBe(false);
    expect(filterClientSentryEvent(event)).toBe(event);
  });

  it("keeps unrelated client errors", () => {
    const event = createEvent({
      message: "Cannot read properties of undefined (reading 'id')",
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Cannot read properties of undefined (reading 'id')",
            stacktrace: {
              frames: [
                {
                  filename: "webpack-internal:///./src/app/tasks/page.tsx",
                  function: "TaskPage",
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
