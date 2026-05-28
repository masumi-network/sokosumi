import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  eventHasBrowserExtensionFrame,
  isThirdPartyFetchFailureMessage,
  shouldDropClientSentryEvent,
} from "@/lib/sentry/client-event-filters";

function makeEvent(partial: Partial<ErrorEvent>): ErrorEvent {
  return {
    event_id: "test",
    platform: "javascript",
    ...partial,
  } as ErrorEvent;
}

describe("isThirdPartyFetchFailureMessage", () => {
  it("matches LinkedIn ads pixel failures", () => {
    expect(
      isThirdPartyFetchFailureMessage("Failed to fetch (px.ads.linkedin.com)"),
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
            value: "Failed to fetch (px.ads.linkedin.com)",
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

describe("shouldDropClientSentryEvent", () => {
  it("drops SOKOSUMI-P2 style LinkedIn pixel errors", () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (px.ads.linkedin.com)",
            stacktrace: {
              frames: [{ filename: "app:///frame_ant/frame_ant.js" }],
            },
          },
        ],
      },
    });

    expect(shouldDropClientSentryEvent(event)).toBe(true);
  });

  it("keeps first-party fetch failures", () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (api.sokosumi.com)",
          },
        ],
      },
    });

    expect(shouldDropClientSentryEvent(event)).toBe(false);
  });
});
