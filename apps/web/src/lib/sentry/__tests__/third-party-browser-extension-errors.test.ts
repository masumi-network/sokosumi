import { describe, expect, it } from "vitest";

import { isBrowserExtensionOnlyStackError } from "@/lib/sentry/third-party-browser-extension-errors";

describe("isBrowserExtensionOnlyStackError", () => {
  it("matches React DevTools hook.js-only stacks", () => {
    expect(
      isBrowserExtensionOnlyStackError({
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
    ).toBe(true);
  });

  it("matches chrome-extension-only stacks", () => {
    expect(
      isBrowserExtensionOnlyStackError({
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
    ).toBe(true);
  });

  it("does not match mixed extension and app stacks", () => {
    expect(
      isBrowserExtensionOnlyStackError({
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
    ).toBe(false);
  });

  it("does not match errors without stack frames", () => {
    expect(
      isBrowserExtensionOnlyStackError({
        exception: {
          values: [
            {
              value: "Cannot read properties of undefined (reading 'id')",
            },
          ],
        },
      }),
    ).toBe(false);
  });
});
