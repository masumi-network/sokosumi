import { describe, expect, it } from "vitest";

import {
  browserNoiseSentryClientOptions,
  shouldDropBrowserNoiseEvent,
} from "@/lib/sentry/client-event-filter";

function buildEvent(
  value: string,
  filenames: string[],
): Parameters<typeof shouldDropBrowserNoiseEvent>[0] {
  return {
    exception: {
      values: [
        {
          value,
          stacktrace: {
            frames: filenames.map((filename) => ({ filename })),
          },
        },
      ],
    },
  };
}

describe("shouldDropBrowserNoiseEvent", () => {
  it("drops plausible.io fetch failures", () => {
    const event = buildEvent("TypeError: Failed to fetch (plausible.io)", [
      "app:///injectScriptAdjust.js",
      "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
    ]);

    expect(shouldDropBrowserNoiseEvent(event)).toBe(true);
  });

  it("drops events when stack frames come from browser extensions only", () => {
    const event = buildEvent("TypeError: Failed to fetch", [
      "app:///frame_ant/frame_ant.js",
      "app:///injectScriptAdjust.js",
    ]);

    expect(shouldDropBrowserNoiseEvent(event)).toBe(true);
  });

  it("keeps api.sokosumi.com fetch failures", () => {
    const event = buildEvent("TypeError: Failed to fetch (api.sokosumi.com)", [
      "app:///_next/static/chunks/app/layout.js",
    ]);

    expect(shouldDropBrowserNoiseEvent(event)).toBe(false);
  });

  it("keeps app.sokosumi.com fetch failures", () => {
    const event = buildEvent("TypeError: Failed to fetch (app.sokosumi.com)", [
      "app:///_next/static/chunks/app/layout.js",
    ]);

    expect(shouldDropBrowserNoiseEvent(event)).toBe(false);
  });

  it("keeps generic failed to fetch errors with app stack frames", () => {
    const event = buildEvent("TypeError: Failed to fetch", [
      "app:///_next/static/chunks/app/(app)/tasks/page.js",
    ]);

    expect(shouldDropBrowserNoiseEvent(event)).toBe(false);
  });
});

describe("browserNoiseSentryClientOptions", () => {
  it("returns null from beforeSend for plausible noise", () => {
    const event = buildEvent("TypeError: Failed to fetch (plausible.io)", [
      "app:///frame_ant/frame_ant.js",
    ]);

    expect(browserNoiseSentryClientOptions.beforeSend(event)).toBeNull();
  });

  it("passes through first-party fetch failures", () => {
    const event = buildEvent("TypeError: Failed to fetch (api.sokosumi.com)", [
      "app:///_next/static/chunks/app/layout.js",
    ]);

    expect(browserNoiseSentryClientOptions.beforeSend(event)).toBe(event);
  });
});
