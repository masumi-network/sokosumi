import { describe, expect, it } from "vitest";

import { isNmkrEmail } from "./nmkr-email.js";

describe("isNmkrEmail", () => {
  it.each(["alice@nmkr.io", "ALICE@NMKR.IO"])(
    "accepts an exact nmkr.io email: %s",
    (email) => {
      expect(isNmkrEmail(email)).toBe(true);
    },
  );

  it.each([
    undefined,
    null,
    "",
    "alice@sub.nmkr.io",
    "alice@nmkr.io.example",
    "alice@notnmkr.io",
  ])("rejects a non-NMKR email: %s", (email) => {
    expect(isNmkrEmail(email)).toBe(false);
  });
});
