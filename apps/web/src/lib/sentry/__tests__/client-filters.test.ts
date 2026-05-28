import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  beforeSendClientEvent,
  shouldDropThirdPartyAnalyticsError,
} from "@/lib/sentry/client-filters";

function createFetchFailureEvent(value: string): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value,
        },
      ],
    },
  };
}

describe("shouldDropThirdPartyAnalyticsError", () => {
  it("drops LinkedIn Insight Tag fetch failures", () => {
    const event = createFetchFailureEvent(
      "Failed to fetch (px.ads.linkedin.com)",
    );

    expect(shouldDropThirdPartyAnalyticsError(event)).toBe(true);
  });

  it("drops Plausible fetch failures", () => {
    const event = createFetchFailureEvent("Failed to fetch (plausible.io)");

    expect(shouldDropThirdPartyAnalyticsError(event)).toBe(true);
  });

  it("keeps first-party server action fetch failures", () => {
    const event = createFetchFailureEvent("Failed to fetch");

    expect(shouldDropThirdPartyAnalyticsError(event)).toBe(false);
  });

  it("keeps fetch failures to Sokosumi hosts", () => {
    const event = createFetchFailureEvent("Failed to fetch (app.sokosumi.com)");

    expect(shouldDropThirdPartyAnalyticsError(event)).toBe(false);
  });
});

describe("beforeSendClientEvent", () => {
  it("returns null for filtered third-party analytics errors", () => {
    const event = createFetchFailureEvent(
      "Failed to fetch (px.ads.linkedin.com)",
    );

    expect(beforeSendClientEvent(event)).toBeNull();
  });

  it("returns the event for actionable application errors", () => {
    const event = createFetchFailureEvent("Failed to fetch");

    expect(beforeSendClientEvent(event)).toBe(event);
  });
});
