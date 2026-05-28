import { describe, expect, it } from "vitest";

import {
  sentryClientDenyUrls,
  sentryClientIgnoreErrors,
  shouldDropClientSentryEvent,
} from "@/lib/sentry/client-error-filters";

describe("sentry client error filters", () => {
  it("matches plausible fetch failure messages", () => {
    const pattern = sentryClientIgnoreErrors[0];
    expect(pattern).toBeInstanceOf(RegExp);

    expect("TypeError: Failed to fetch (plausible.io)").toMatch(
      pattern as RegExp,
    );
    expect("Failed to fetch (plausible.io)").toMatch(pattern as RegExp);
    expect("TypeError: Failed to fetch (api.sokosumi.com)").not.toMatch(
      pattern as RegExp,
    );
  });

  it("denies plausible script urls", () => {
    const pattern = sentryClientDenyUrls[0];
    expect("https://plausible.io/js/script.js").toMatch(pattern as RegExp);
    expect("https://app.sokosumi.com/_next/static/chunks/app.js").not.toMatch(
      pattern as RegExp,
    );
  });

  it("drops events with plausible fetch failure message", () => {
    expect(
      shouldDropClientSentryEvent({
        message: "Failed to fetch (plausible.io)",
        exception: {
          values: [
            {
              type: "TypeError",
              value: "Failed to fetch (plausible.io)",
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("keeps first-party fetch failures", () => {
    expect(
      shouldDropClientSentryEvent({
        message: "Failed to fetch",
        exception: {
          values: [
            {
              type: "TypeError",
              value: "Failed to fetch",
              stacktrace: {
                frames: [
                  {
                    filename: "app:///_next/static/chunks/app.js",
                    in_app: true,
                  },
                ],
              },
            },
          ],
        },
      }),
    ).toBe(false);
  });
});
