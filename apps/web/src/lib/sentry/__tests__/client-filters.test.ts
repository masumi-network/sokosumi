import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { shouldDropClientSentryEvent } from "@/lib/sentry/client-filters";

function errorEvent(message: string, frames: string[] = []): ErrorEvent {
  return {
    exception: {
      values: [
        {
          value: message,
          stacktrace: {
            frames: frames.map((filename) => ({ filename })),
          },
        },
      ],
    },
  } as ErrorEvent;
}

describe("shouldDropClientSentryEvent", () => {
  it("drops Plausible fetch failures by host", () => {
    expect(
      shouldDropClientSentryEvent(
        errorEvent("TypeError: Failed to fetch (plausible.io)"),
      ),
    ).toBe(true);
  });

  it("drops other known analytics/ad fetch failures", () => {
    expect(
      shouldDropClientSentryEvent(
        errorEvent("TypeError: Failed to fetch (px.ads.linkedin.com)"),
      ),
    ).toBe(true);
    expect(
      shouldDropClientSentryEvent(
        errorEvent("TypeError: Failed to fetch (region1.google-analytics.com)"),
      ),
    ).toBe(true);
  });

  it("drops Usercentrics dynamic import failures", () => {
    expect(
      shouldDropClientSentryEvent(
        errorEvent(
          "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/3.121.1/WebSdk.lib.js. Error: undefined",
        ),
      ),
    ).toBe(true);
  });

  it("drops fetch failures when stack originates from Plausible script", () => {
    expect(
      shouldDropClientSentryEvent(
        errorEvent("TypeError: Failed to fetch", [
          "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
        ]),
      ),
    ).toBe(true);
  });

  it("keeps app API fetch failures", () => {
    expect(
      shouldDropClientSentryEvent(
        errorEvent("TypeError: Failed to fetch (api.sokosumi.com)"),
      ),
    ).toBe(false);
    expect(
      shouldDropClientSentryEvent(
        errorEvent("TypeError: Failed to fetch (app.sokosumi.com)"),
      ),
    ).toBe(false);
  });

  it("keeps bare fetch failures without third-party signals", () => {
    expect(
      shouldDropClientSentryEvent(
        errorEvent("TypeError: Failed to fetch", [
          "webpack://_N_E/./src/lib/clients/core.shared.ts",
        ]),
      ),
    ).toBe(false);
  });
});
