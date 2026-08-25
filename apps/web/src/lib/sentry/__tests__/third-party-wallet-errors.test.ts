import { describe, expect, it } from "vitest";

import {
  isThirdPartyWalletError,
  thirdPartyWalletIgnoreErrors,
} from "@/lib/sentry/third-party-wallet-errors";

describe("thirdPartyWalletIgnoreErrors", () => {
  function matchesIgnoreErrors(message: string): boolean {
    return thirdPartyWalletIgnoreErrors.some((pattern) =>
      pattern.test(message),
    );
  }

  it("matches Cardano wallet REQUEST_ID failures", () => {
    expect(
      matchesIgnoreErrors(
        "Cannot read properties of undefined (reading 'REQUEST_ID')",
      ),
    ).toBe(true);
  });

  it("matches MetaMask connect failures", () => {
    expect(matchesIgnoreErrors("Failed to connect to MetaMask")).toBe(true);
  });

  it("matches Cardano wallet read-only window.cardano failures", () => {
    expect(
      matchesIgnoreErrors(
        "Cannot assign to read only property 'cardano' of object '#<Window>'",
      ),
    ).toBe(true);
  });
});

describe("isThirdPartyWalletError", () => {
  it("matches Cardano bundle stack frames", () => {
    expect(
      isThirdPartyWalletError("TypeError: something went wrong", {
        type: undefined,
        exception: {
          values: [
            {
              value: "TypeError: something went wrong",
              stacktrace: {
                frames: [{ filename: "app:///js/cardano.bundle.js" }],
              },
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("matches injected.js wallet extension stack frames", () => {
    expect(
      isThirdPartyWalletError(
        "Cannot assign to read only property 'cardano' of object '#<Window>'",
        {
          type: undefined,
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
        },
      ),
    ).toBe(true);
  });

  it("matches Begin Wallet requestProvider.js stacks (SOKOSUMI-RC)", () => {
    expect(
      isThirdPartyWalletError(
        "Cannot read properties of undefined (reading 'type')",
        {
          type: undefined,
          exception: {
            values: [
              {
                type: "TypeError",
                value: "Cannot read properties of undefined (reading 'type')",
                stacktrace: {
                  frames: [{ filename: "app:///requestProvider.js" }],
                },
              },
            ],
          },
        },
      ),
    ).toBe(true);
  });

  it("matches Begin Wallet requestSolanaProvider.js stacks (SOKOSUMI-RD)", () => {
    expect(
      isThirdPartyWalletError(
        "Cannot read properties of undefined (reading 'type')",
        {
          type: undefined,
          exception: {
            values: [
              {
                type: "TypeError",
                value: "Cannot read properties of undefined (reading 'type')",
                stacktrace: {
                  frames: [
                    {
                      filename: "app:///requestSolanaProvider.js",
                      function: "a.handleResponse",
                    },
                    { filename: "app:///requestSolanaProvider.js" },
                  ],
                },
              },
            ],
          },
        },
      ),
    ).toBe(true);
  });

  it("does not match bare reading 'type' without wallet frames", () => {
    expect(
      isThirdPartyWalletError(
        "Cannot read properties of undefined (reading 'type')",
        {
          type: undefined,
          exception: {
            values: [
              {
                type: "TypeError",
                value: "Cannot read properties of undefined (reading 'type')",
                stacktrace: {
                  frames: [
                    { filename: "app:///_next/static/chunks/app/page.js" },
                  ],
                },
              },
            ],
          },
        },
      ),
    ).toBe(false);
  });

  it("ignores unrelated application errors", () => {
    expect(
      isThirdPartyWalletError("Database unavailable", {
        type: undefined,
        exception: {
          values: [
            {
              value: "Database unavailable",
              stacktrace: {
                frames: [{ filename: "app:///src/lib/services/user.ts" }],
              },
            },
          ],
        },
      }),
    ).toBe(false);
  });
});
