import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  getFailedFetchDomain,
  isBlockedThirdPartyAnalyticsFetchFailure,
  shouldDropClientSentryEvent,
} from "@/lib/sentry/client-error-filters";

describe("getFailedFetchDomain", () => {
  it("extracts the host from Chrome fetch failure messages", () => {
    expect(getFailedFetchDomain("Failed to fetch (plausible.io)")).toBe(
      "plausible.io",
    );
  });

  it("returns null when the message has no host suffix", () => {
    expect(getFailedFetchDomain("Failed to fetch")).toBeNull();
  });
});

describe("isBlockedThirdPartyAnalyticsFetchFailure", () => {
  it("returns true for plausible.io fetch failures", () => {
    expect(
      isBlockedThirdPartyAnalyticsFetchFailure(
        new TypeError("Failed to fetch (plausible.io)"),
      ),
    ).toBe(true);
  });

  it("returns false for first-party API fetch failures", () => {
    expect(
      isBlockedThirdPartyAnalyticsFetchFailure(
        new TypeError("Failed to fetch (api.sokosumi.com)"),
      ),
    ).toBe(false);
  });

  it("returns false for generic fetch failures without a host", () => {
    expect(
      isBlockedThirdPartyAnalyticsFetchFailure(
        new TypeError("Failed to fetch"),
      ),
    ).toBe(false);
  });
});

describe("shouldDropClientSentryEvent", () => {
  it("drops plausible fetch failures from the original exception", () => {
    const event = {
      exception: {
        values: [
          { value: "Failed to fetch (plausible.io)", type: "TypeError" },
        ],
      },
    } as ErrorEvent;
    const hint = {
      originalException: new TypeError("Failed to fetch (plausible.io)"),
    } as EventHint;

    expect(shouldDropClientSentryEvent(event, hint)).toBe(true);
  });

  it("drops events whose stack frames reference the plausible script", () => {
    const event = {
      exception: {
        values: [
          {
            value: "Failed to fetch (plausible.io)",
            type: "TypeError",
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
    } as ErrorEvent;
    const hint = { originalException: undefined } as EventHint;

    expect(shouldDropClientSentryEvent(event, hint)).toBe(true);
  });

  it("keeps first-party API fetch failures", () => {
    const event = {
      exception: {
        values: [
          { value: "Failed to fetch (api.sokosumi.com)", type: "TypeError" },
        ],
      },
    } as ErrorEvent;
    const hint = {
      originalException: new TypeError("Failed to fetch (api.sokosumi.com)"),
    } as EventHint;

    expect(shouldDropClientSentryEvent(event, hint)).toBe(false);
  });
});
