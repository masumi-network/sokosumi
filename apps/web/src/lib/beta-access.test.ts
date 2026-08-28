import { describe, expect, it } from "vitest";

import { isBetaAccessEmail } from "@/lib/beta-access";

describe("isBetaAccessEmail", () => {
  it.each(["a@nmkr.io", "A@NMKR.IO", "patrick@nmkr.io"])(
    "allows nmkr.io email %s",
    (email) => {
      expect(isBetaAccessEmail(email)).toBe(true);
    },
  );

  it.each([
    ["a subdomain", "a@sub.nmkr.io"],
    ["a lookalike domain", "a@nmkr.io.evil.com"],
    ["another company", "someone@house-of-communication.com"],
    ["a plain gmail", "someone@gmail.com"],
    ["not an email", "not-an-email"],
    ["empty string", ""],
  ])("denies %s", (_label, email) => {
    expect(isBetaAccessEmail(email)).toBe(false);
  });

  it("denies null and undefined", () => {
    expect(isBetaAccessEmail(null)).toBe(false);
    expect(isBetaAccessEmail(undefined)).toBe(false);
  });
});
