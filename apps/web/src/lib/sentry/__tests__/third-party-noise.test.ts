import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  beforeSendThirdPartyNoiseFilter,
  shouldDropThirdPartyNoise,
} from "@/lib/sentry/third-party-noise";

function createErrorEvent(
  message: string,
  filenames: string[] = [],
): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: message,
          stacktrace: {
            frames: filenames.map((filename) => ({ filename })),
          },
        },
      ],
    },
  } as ErrorEvent;
}

describe("shouldDropThirdPartyNoise", () => {
  it("drops LinkedIn Insight pixel fetch failures", () => {
    const event = createErrorEvent("Failed to fetch (px.ads.linkedin.com)", [
      "app:///li.lms-analytics/insight.old.min.js",
    ]);

    expect(shouldDropThirdPartyNoise(event)).toBe(true);
  });

  it("drops plausible.io fetch failures", () => {
    const event = createErrorEvent("Failed to fetch (plausible.io)");

    expect(shouldDropThirdPartyNoise(event)).toBe(true);
  });

  it("drops usercentrics dynamic import failures", () => {
    const event = createErrorEvent(
      "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/3.121.1/WebSdk.lib.44b003b5.js. Error: undefined",
    );

    expect(shouldDropThirdPartyNoise(event)).toBe(true);
  });

  it("keeps api.sokosumi.com fetch failures", () => {
    const event = createErrorEvent("Failed to fetch (api.sokosumi.com)");

    expect(shouldDropThirdPartyNoise(event)).toBe(false);
  });

  it("keeps app.sokosumi.com fetch failures", () => {
    const event = createErrorEvent("Failed to fetch (app.sokosumi.com)");

    expect(shouldDropThirdPartyNoise(event)).toBe(false);
  });

  it("keeps application errors without third-party markers", () => {
    const event = createErrorEvent("TypeError: Cannot read properties of null");

    expect(shouldDropThirdPartyNoise(event)).toBe(false);
  });
});

describe("beforeSendThirdPartyNoiseFilter", () => {
  it("returns null when noise should be dropped", () => {
    const event = createErrorEvent("Failed to fetch (px.ads.linkedin.com)");

    expect(beforeSendThirdPartyNoiseFilter(event)).toBeNull();
  });

  it("returns the event when it should be reported", () => {
    const event = createErrorEvent("Failed to fetch (api.sokosumi.com)");

    expect(beforeSendThirdPartyNoiseFilter(event)).toBe(event);
  });
});
