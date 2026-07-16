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
