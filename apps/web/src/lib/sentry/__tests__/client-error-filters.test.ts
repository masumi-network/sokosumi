import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  beforeSendClientEvent,
  isThirdPartyClientNoise,
  thirdPartyFetchFailureIgnoreErrors,
} from "@/lib/sentry/client-error-filters";

function createEvent(message: string, frames: string[] = []): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: message,
          stacktrace: {
            frames: frames.map((filename) => ({ filename })),
          },
        },
      ],
    },
  };
}

function createHint(message: string): EventHint {
  return {
    originalException: new TypeError(message),
  };
}

describe("client-error-filters", () => {
  it("matches plausible fetch failures in ignoreErrors patterns", () => {
    expect(
      thirdPartyFetchFailureIgnoreErrors.some((pattern) =>
        pattern.test("Failed to fetch (plausible.io)"),
      ),
    ).toBe(true);
  });

  it("treats plausible analytics fetch failures as third-party noise", () => {
    const event = createEvent("Failed to fetch (plausible.io)", [
      "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
    ]);
    const hint = createHint("Failed to fetch (plausible.io)");

    expect(isThirdPartyClientNoise(event, hint)).toBe(true);
    expect(beforeSendClientEvent(event, hint)).toBeNull();
  });

  it("treats linkedin ad fetch failures as third-party noise", () => {
    const event = createEvent("Failed to fetch (px.ads.linkedin.com)");
    const hint = createHint("Failed to fetch (px.ads.linkedin.com)");

    expect(isThirdPartyClientNoise(event, hint)).toBe(true);
  });

  it("treats usercentrics dynamic import failures as third-party noise", () => {
    const message =
      "Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/TvGdprCmpView.a460128e.js. Error: undefined";
    const event = createEvent(message);
    const hint = createHint(message);

    expect(isThirdPartyClientNoise(event, hint)).toBe(true);
  });

  it("does not drop first-party fetch failures", () => {
    const event = createEvent("Failed to fetch (app.sokosumi.com)", [
      "webpack-internal:///./src/lib/clients/core.shared.ts",
    ]);
    const hint = createHint("Failed to fetch (app.sokosumi.com)");

    expect(isThirdPartyClientNoise(event, hint)).toBe(false);
    expect(beforeSendClientEvent(event, hint)).toBe(event);
  });

  it("does not drop generic fetch failures without third-party markers", () => {
    const event = createEvent("Failed to fetch", [
      "webpack-internal:///./src/hooks/use-job-submission.ts",
    ]);
    const hint = createHint("Failed to fetch");

    expect(isThirdPartyClientNoise(event, hint)).toBe(false);
  });
});
