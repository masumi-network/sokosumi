import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import {
  beforeSendClientError,
  shouldDropClientErrorEvent,
} from "@/lib/sentry/client-error-filters";

function makeEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    event_id: "test",
    platform: "javascript",
    ...overrides,
  } as ErrorEvent;
}

function makeHint(error?: unknown): EventHint {
  return { originalException: error };
}

describe("shouldDropClientErrorEvent", () => {
  it("drops LinkedIn insight pixel fetch failures", () => {
    const message = "Failed to fetch (px.ads.linkedin.com)";
    const event = makeEvent({
      exception: {
        values: [{ type: "TypeError", value: message }],
      },
    });

    expect(
      shouldDropClientErrorEvent(
        event,
        makeHint(new TypeError("Failed to fetch (px.ads.linkedin.com)")),
      ),
    ).toBe(true);
  });

  it("drops Plausible analytics fetch failures", () => {
    const message = "Failed to fetch (plausible.io)";
    const event = makeEvent({
      exception: {
        values: [{ type: "TypeError", value: message }],
      },
    });

    expect(
      shouldDropClientErrorEvent(
        event,
        makeHint(new TypeError("Failed to fetch (plausible.io)")),
      ),
    ).toBe(true);
  });

  it("drops extension-only Failed to fetch stacks (frame_ant)", () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch",
            stacktrace: {
              frames: [
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
    });

    expect(
      shouldDropClientErrorEvent(
        event,
        makeHint(new TypeError("Failed to fetch")),
      ),
    ).toBe(true);
  });

  it("keeps Failed to fetch when an in-app frame is present", () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch",
            stacktrace: {
              frames: [
                {
                  filename: "webpack://_N_E/./src/hooks/use-job-submission.ts",
                  in_app: true,
                },
                {
                  filename: "app:///frame_ant/frame_ant.js",
                  in_app: false,
                },
              ],
            },
          },
        ],
      },
    });

    expect(
      shouldDropClientErrorEvent(
        event,
        makeHint(new TypeError("Failed to fetch")),
      ),
    ).toBe(false);
  });

  it("keeps generic Failed to fetch without third-party host suffix", () => {
    const event = makeEvent({
      exception: {
        values: [{ type: "TypeError", value: "Failed to fetch" }],
      },
    });

    expect(
      shouldDropClientErrorEvent(
        event,
        makeHint(new TypeError("Failed to fetch")),
      ),
    ).toBe(false);
  });
});

describe("beforeSendClientError", () => {
  it("returns null when the event should be dropped", () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (px.ads.linkedin.com)",
          },
        ],
      },
    });

    expect(
      beforeSendClientError(
        event,
        makeHint(new TypeError("Failed to fetch (px.ads.linkedin.com)")),
      ),
    ).toBeNull();
  });

  it("returns the event when it should be reported", () => {
    const event = makeEvent({
      exception: {
        values: [{ type: "TypeError", value: "Failed to fetch" }],
      },
    });

    expect(
      beforeSendClientError(event, makeHint(new TypeError("Failed to fetch"))),
    ).toBe(event);
  });
});
