import { describe, expect, it } from "vitest";

import {
  beforeSendBrowserNoiseFilter,
  shouldDropBrowserNoiseEvent,
} from "@/lib/sentry/client-event-filters";

function createEvent(
  overrides: {
    message?: string;
    exceptionValue?: string;
    frameFilenames?: string[];
  } = {},
) {
  const frames = (overrides.frameFilenames ?? []).map((filename) => ({
    filename,
  }));

  return {
    message: overrides.message,
    exception: overrides.exceptionValue
      ? {
          values: [
            {
              value: overrides.exceptionValue,
              stacktrace: frames.length > 0 ? { frames } : undefined,
            },
          ],
        }
      : frames.length > 0
        ? {
            values: [
              {
                type: "TypeError",
                value: overrides.message ?? "Error",
                stacktrace: { frames },
              },
            ],
          }
        : undefined,
  };
}

describe("shouldDropBrowserNoiseEvent", () => {
  it("drops plausible.io fetch failures from browser extensions", () => {
    const event = createEvent({
      exceptionValue: "Failed to fetch (plausible.io)",
      frameFilenames: ["app:///frame_ant/frame_ant.js"],
    });

    expect(shouldDropBrowserNoiseEvent(event)).toBe(true);
  });

  it("drops injectScriptAdjust extension stack traces", () => {
    const event = createEvent({
      exceptionValue: "Failed to fetch (plausible.io)",
      frameFilenames: ["app:///injectScriptAdjust.js"],
    });

    expect(shouldDropBrowserNoiseEvent(event)).toBe(true);
  });

  it("drops linkedin pixel fetch failures", () => {
    const event = createEvent({
      exceptionValue: "Failed to fetch (px.ads.linkedin.com)",
    });

    expect(shouldDropBrowserNoiseEvent(event)).toBe(true);
  });

  it("keeps generic failed to fetch errors without extension frames", () => {
    const event = createEvent({
      exceptionValue: "Failed to fetch",
      frameFilenames: ["webpack://_next/static/chunks/app/layout.js"],
    });

    expect(shouldDropBrowserNoiseEvent(event)).toBe(false);
  });

  it("keeps application errors", () => {
    const event = createEvent({
      exceptionValue: "Cannot read properties of undefined",
      frameFilenames: ["webpack://_next/static/chunks/app/tasks/page.js"],
    });

    expect(shouldDropBrowserNoiseEvent(event)).toBe(false);
  });
});

describe("beforeSendBrowserNoiseFilter", () => {
  it("returns null when the event should be dropped", () => {
    const event = createEvent({
      exceptionValue: "Failed to fetch (plausible.io)",
      frameFilenames: ["app:///frame_ant/frame_ant.js"],
    });

    expect(beforeSendBrowserNoiseFilter(event, {})).toBeNull();
  });

  it("returns the event when it should be kept", () => {
    const event = createEvent({
      exceptionValue: "Something went wrong",
      frameFilenames: ["webpack://_next/static/chunks/app/page.js"],
    });

    expect(beforeSendBrowserNoiseFilter(event, {})).toBe(event);
  });
});
