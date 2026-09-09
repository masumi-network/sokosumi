import { describe, expect, it } from "vitest";

import {
  firefoxReaderBridgeIgnoreErrors,
  isFirefoxReaderBridgeError,
} from "@/lib/sentry/third-party-browser-environment-errors";

describe("isFirefoxReaderBridgeError", () => {
  it("matches Brave/WebKit TypeError probing window.__firefox__.reader", () => {
    expect(
      isFirefoxReaderBridgeError(
        "undefined is not an object (evaluating 'window.__firefox__.reader')",
      ),
    ).toBe(true);
  });

  it("matches the TypeError-prefixed production message", () => {
    expect(
      isFirefoxReaderBridgeError(
        "TypeError: undefined is not an object (evaluating 'window.__firefox__.reader')",
      ),
    ).toBe(true);
  });

  it("matches a general window.__firefox__ probe", () => {
    expect(
      isFirefoxReaderBridgeError(
        "undefined is not an object (evaluating 'window.__firefox__')",
      ),
    ).toBe(true);
  });

  it("matches WebKit ReferenceError for a missing __firefox__ global", () => {
    expect(isFirefoxReaderBridgeError("Can't find variable: __firefox__")).toBe(
      true,
    );
  });

  it("does not match first-party application errors", () => {
    expect(
      isFirefoxReaderBridgeError(
        "TypeError: Cannot read properties of undefined (reading 'messages')",
      ),
    ).toBe(false);
  });
});

describe("firefoxReaderBridgeIgnoreErrors", () => {
  function matchesIgnoreErrors(message: string): boolean {
    return firefoxReaderBridgeIgnoreErrors.some((pattern) =>
      pattern.test(message),
    );
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
