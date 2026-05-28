import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  eventHasBrowserExtensionFrame,
  isThirdPartyFetchFailureMessage,
  shouldDropThirdPartyAnalyticsNoise,
} from "@/lib/sentry/client-event-filters";

function makeEvent(partial: Partial<ErrorEvent>): ErrorEvent {
  return {
    event_id: "test",
    platform: "javascript",
    ...partial,
  } as ErrorEvent;
}

describe("isThirdPartyFetchFailureMessage", () => {
  it("matches LinkedIn ads pixel failures with TypeError prefix", () => {
    expect(
      isThirdPartyFetchFailureMessage(
        "TypeError: Failed to fetch (px.ads.linkedin.com)",
      ),
    ).toBe(true);
  });

  it("matches Plausible analytics failures", () => {
    expect(
      isThirdPartyFetchFailureMessage("Failed to fetch (plausible.io)"),
    ).toBe(true);
  });

  it("does not match first-party API failures", () => {
    expect(
      isThirdPartyFetchFailureMessage("Failed to fetch (api.sokosumi.com)"),
    ).toBe(false);
  });

  it("does not match generic fetch failures without a host", () => {
    expect(isThirdPartyFetchFailureMessage("Failed to fetch")).toBe(false);
  });
});

describe("eventHasBrowserExtensionFrame", () => {
  it("detects extension-injected stack frames", () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "TypeError: Failed to fetch (px.ads.linkedin.com)",
            stacktrace: {
              frames: [{ filename: "app:///frame_ant/frame_ant.js" }],
            },
          },
        ],
      },
    });

    expect(eventHasBrowserExtensionFrame(event)).toBe(true);
  });
});

describe("shouldDropThirdPartyAnalyticsNoise", () => {
  it("drops SOKOSUMI-P2 style LinkedIn pixel errors", () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "TypeError: Failed to fetch (px.ads.linkedin.com)",
            stacktrace: {
              frames: [
                { filename: "app:///li.lms-analytics/insight.old.min.js" },
                { filename: "app:///frame_ant/frame_ant.js" },
              ],
            },
          },
        ],
      },
    });

    expect(shouldDropThirdPartyAnalyticsNoise(event)).toBe(true);
  });

  it("drops plausible.io failed fetch errors", () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "TypeError: Failed to fetch (plausible.io)",
            stacktrace: {
              frames: [
                {
                  filename:
                    "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
                },
              ],
            },
          },
        ],
      },
    });

    expect(shouldDropThirdPartyAnalyticsNoise(event)).toBe(true);
  });

  it("drops plausible script failures wrapped by browser extensions", () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "TypeError: Failed to fetch",
            stacktrace: {
              frames: [
                { filename: "app:///js/script.plausible.io.js" },
                { filename: "app:///frame_ant/frame_ant.js" },
              ],
            },
          },
        ],
      },
    });

    expect(shouldDropThirdPartyAnalyticsNoise(event)).toBe(true);
  });

  it("keeps first-party fetch failures", () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "TypeError: Failed to fetch (api.sokosumi.com)",
            stacktrace: {
              frames: [
                { filename: "webpack:///src/lib/clients/core.shared.ts" },
              ],
            },
          },
        ],
      },
    });

    expect(shouldDropThirdPartyAnalyticsNoise(event)).toBe(false);
  });

  it("keeps app fetch failures without analytics host or script frames", () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "TypeError: Failed to fetch",
            stacktrace: {
              frames: [
                { filename: "webpack:///src/lib/clients/core.shared.ts" },
              ],
            },
          },
        ],
      },
    });

    expect(shouldDropThirdPartyAnalyticsNoise(event)).toBe(false);
  });
});
