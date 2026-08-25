import { describe, expect, it } from "vitest";

import { createErrorEvent } from "@/lib/sentry/__tests__/error-event-fixture";
import { isBrowserExtensionOnlyStackError } from "@/lib/sentry/third-party-browser-extension-errors";

describe("isBrowserExtensionOnlyStackError", () => {
  it("matches React DevTools hook.js-only stacks", () => {
    expect(
      isBrowserExtensionOnlyStackError(
        createErrorEvent({
          exception: {
            values: [
              {
                value: "Cannot read properties of undefined (reading 'id')",
                stacktrace: {
                  frames: [{ filename: "app:///hook.js" }],
                },
              },
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  it("matches wallet injected.js-only stacks", () => {
    expect(
      isBrowserExtensionOnlyStackError(
        createErrorEvent({
          exception: {
            values: [
              {
                value:
                  "Cannot assign to read only property 'cardano' of object '#<Window>'",
                stacktrace: {
                  frames: [{ filename: "app:///static/js/injected.js" }],
                },
              },
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  it("matches Begin Wallet requestProvider.js-only stacks", () => {
    expect(
      isBrowserExtensionOnlyStackError(
        createErrorEvent({
          exception: {
            values: [
              {
                value: "Cannot read properties of undefined (reading 'type')",
                stacktrace: {
                  frames: [{ filename: "app:///requestProvider.js" }],
                },
              },
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  it("matches Begin Wallet requestSolanaProvider.js-only stacks", () => {
    expect(
      isBrowserExtensionOnlyStackError(
        createErrorEvent({
          exception: {
            values: [
              {
                value: "Cannot read properties of undefined (reading 'type')",
                stacktrace: {
                  frames: [
                    {
                      filename: "app:///requestSolanaProvider.js",
                      function: "a.handleResponse",
                    },
                  ],
                },
              },
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  it("matches chrome-extension-only stacks", () => {
    expect(
      isBrowserExtensionOnlyStackError(
        createErrorEvent({
          exception: {
            values: [
              {
                value: "Extension error",
                stacktrace: {
                  frames: [
                    {
                      filename:
                        "chrome-extension://abcdefghijklmnop/content-script.js",
                    },
                  ],
                },
              },
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  it("does not match mixed extension and app stacks", () => {
    expect(
      isBrowserExtensionOnlyStackError(
        createErrorEvent({
          exception: {
            values: [
              {
                value: "Cannot read properties of undefined (reading 'id')",
                stacktrace: {
                  frames: [
                    { filename: "app:///hook.js" },
                    { filename: "app:///_next/static/chunks/app/page.js" },
                  ],
                },
              },
            ],
          },
        }),
      ),
    ).toBe(false);
  });

  it("does not match errors without stack frames", () => {
    expect(
      isBrowserExtensionOnlyStackError(
        createErrorEvent({
          exception: {
            values: [
              {
                value: "Cannot read properties of undefined (reading 'id')",
              },
            ],
          },
        }),
      ),
    ).toBe(false);
  });
});
