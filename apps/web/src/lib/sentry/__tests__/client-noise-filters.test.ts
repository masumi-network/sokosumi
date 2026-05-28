import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  beforeSendClientEvent,
  isThirdPartyAnalyticsFetchFailure,
} from "@/lib/sentry/client-noise-filters";

function createErrorEvent(message: string): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: message.replace(/^TypeError: /, ""),
        },
      ],
    },
    message,
  } as ErrorEvent;
}

describe("isThirdPartyAnalyticsFetchFailure", () => {
  it("returns true for Plausible analytics fetch failures", () => {
    const event = createErrorEvent("TypeError: Failed to fetch (plausible.io)");

    expect(isThirdPartyAnalyticsFetchFailure(event)).toBe(true);
  });

  it("returns true for Google ad network fetch failures", () => {
    const event = createErrorEvent(
      "TypeError: Failed to fetch (pagead2.googlesyndication.com)",
    );

    expect(isThirdPartyAnalyticsFetchFailure(event)).toBe(true);
  });

  it("returns true for Usercentrics dynamic import failures", () => {
    const event = createErrorEvent(
      "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/WebSdk.lib.js. Error: undefined",
    );

    expect(isThirdPartyAnalyticsFetchFailure(event)).toBe(true);
  });

  it("returns false for first-party app fetch failures", () => {
    const event = createErrorEvent(
      "TypeError: Failed to fetch (app.sokosumi.com)",
    );

    expect(isThirdPartyAnalyticsFetchFailure(event)).toBe(false);
  });

  it("returns false for generic fetch failures without a third-party host", () => {
    const event = createErrorEvent("TypeError: Failed to fetch");

    expect(isThirdPartyAnalyticsFetchFailure(event)).toBe(false);
  });
});

describe("beforeSendClientEvent", () => {
  it("drops third-party analytics fetch failures", () => {
    const event = createErrorEvent("TypeError: Failed to fetch (plausible.io)");

    expect(beforeSendClientEvent(event)).toBeNull();
  });

  it("keeps first-party fetch failures", () => {
    const event = createErrorEvent(
      "TypeError: Failed to fetch (app.sokosumi.com)",
    );

    expect(beforeSendClientEvent(event)).toBe(event);
  });
});
