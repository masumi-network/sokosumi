import type { ErrorEvent } from "@sentry/core";
import { describe, expect, it } from "vitest";

import {
  hasBrowserExtensionStackFrame,
  isBrowserExtensionStackFrame,
  isPlausibleFetchFailure,
  shouldDropClientSentryEvent,
} from "@/lib/sentry/client-event-filters";

function createEvent(partial: ErrorEvent): ErrorEvent {
  return partial;
}

describe("isBrowserExtensionStackFrame", () => {
  it("detects chrome extension script URLs", () => {
    expect(
      isBrowserExtensionStackFrame(
        "chrome-extension://abc123/content/injectScriptAdjust.js",
      ),
    ).toBe(true);
  });

  it("detects extension inject script filenames", () => {
    expect(isBrowserExtensionStackFrame("app:///injectScriptAdjust.js")).toBe(
      true,
    );
  });

  it("does not flag application bundles", () => {
    expect(
      isBrowserExtensionStackFrame(
        "https://app.sokosumi.com/_next/static/chunks/app.js",
      ),
    ).toBe(false);
  });
});

describe("isPlausibleFetchFailure", () => {
  it("matches SOKOSUMI-NQ error text", () => {
    const event = createEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (plausible.io)",
          },
        ],
      },
    });

    expect(isPlausibleFetchFailure(event)).toBe(true);
  });

  it("does not match unrelated fetch failures", () => {
    const event = createEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch",
          },
        ],
      },
    });

    expect(isPlausibleFetchFailure(event)).toBe(false);
  });
});

describe("shouldDropClientSentryEvent", () => {
  it("drops extension-originated errors", () => {
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
              ],
            },
          },
        ],
      },
    });

    expect(shouldDropClientSentryEvent(event)).toBe(true);
    expect(hasBrowserExtensionStackFrame(event)).toBe(true);
  });

  it("keeps application errors", () => {
    const event = createEvent({
      exception: {
        values: [
          {
            type: "Error",
            value: "Task sync failed",
            stacktrace: {
              frames: [
                {
                  filename:
                    "https://app.sokosumi.com/_next/static/chunks/app.js",
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
