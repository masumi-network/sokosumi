import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import {
  CLIENT_IGNORE_ERRORS,
  shouldDropClientSentryEvent,
} from "@/lib/sentry/client-error-filters";

function createEvent(
  message: string,
  frames: Array<{ filename?: string; abs_path?: string }> = [],
): ErrorEvent {
  return {
    exception: {
      values: [
        {
          value: message,
          stacktrace: frames.length > 0 ? { frames } : undefined,
        },
      ],
    },
  };
}

describe("CLIENT_IGNORE_ERRORS", () => {
  it("matches the plausible.io fetch rejection message", () => {
    const pattern = CLIENT_IGNORE_ERRORS[0];
    expect(pattern).toBeInstanceOf(RegExp);
    expect(
      (pattern as RegExp).test("TypeError: Failed to fetch (plausible.io)"),
    ).toBe(true);
  });
});

describe("shouldDropClientSentryEvent", () => {
  it("drops plausible.io failed fetch errors", () => {
    expect(
      shouldDropClientSentryEvent(
        createEvent("TypeError: Failed to fetch (plausible.io)"),
      ),
    ).toBe(true);
  });

  it("drops failed fetch errors with plausible script frames", () => {
    expect(
      shouldDropClientSentryEvent(
        createEvent("TypeError: Failed to fetch", [
          {
            filename:
              "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
          },
        ]),
      ),
    ).toBe(true);
  });

  it("keeps unrelated failed fetch errors", () => {
    expect(
      shouldDropClientSentryEvent(
        createEvent("TypeError: Failed to fetch", [
          { filename: "webpack-internal:///./src/lib/clients/core.client.ts" },
        ]),
      ),
    ).toBe(false);
  });

  it("keeps application errors", () => {
    expect(
      shouldDropClientSentryEvent(
        createEvent("Error: Something went wrong in Sokosumi"),
      ),
    ).toBe(false);
  });
});
