import { describe, expect, it } from "vitest";

import {
  firefoxBridgeIgnoreErrors,
  isFirefoxBridgeError,
} from "@/lib/sentry/third-party-browser-environment-errors";

describe("isFirefoxBridgeError", () => {
  it("matches Brave iOS TypeError probing window.__firefox__.reader", () => {
    expect(
      isFirefoxBridgeError(
        "undefined is not an object (evaluating 'window.__firefox__.reader')",
      ),
    ).toBe(true);
  });

  it("matches the TypeError-prefixed production message", () => {
    expect(
      isFirefoxBridgeError(
        "TypeError: undefined is not an object (evaluating 'window.__firefox__.reader')",
      ),
    ).toBe(true);
  });

  it("matches other Brave native handlers on the same bridge", () => {
    expect(
      isFirefoxBridgeError(
        "undefined is not an object (evaluating 'window.__firefox__.refresh_youtube_quality_A00050E02C8142CE86BDDC52A7F78426')",
      ),
    ).toBe(true);
  });

  it("matches a general window.__firefox__ probe", () => {
    expect(
      isFirefoxBridgeError(
        "undefined is not an object (evaluating 'window.__firefox__')",
      ),
    ).toBe(true);
  });

  it("matches WebKit ReferenceError for a missing __firefox__ global", () => {
    expect(isFirefoxBridgeError("Can't find variable: __firefox__")).toBe(true);
  });

  it("does not match first-party application errors", () => {
    expect(
      isFirefoxBridgeError(
        "TypeError: Cannot read properties of undefined (reading 'messages')",
      ),
    ).toBe(false);
  });
});

describe("firefoxBridgeIgnoreErrors", () => {
  function matchesIgnoreErrors(message: string): boolean {
    return firefoxBridgeIgnoreErrors.some((pattern) => pattern.test(message));
  }

  it("matches both production Sentry message shapes", () => {
    expect(
      matchesIgnoreErrors(
        "undefined is not an object (evaluating 'window.__firefox__.reader')",
      ),
    ).toBe(true);
    expect(matchesIgnoreErrors("Can't find variable: __firefox__")).toBe(true);
  });

  it("does not match unrelated application errors", () => {
    expect(
      matchesIgnoreErrors(
        "TypeError: Cannot read properties of undefined (reading 'messages')",
      ),
    ).toBe(false);
  });
});
