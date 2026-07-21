import { describe, expect, it } from "vitest";

import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";

describe("isHermesBetaAccessEmail", () => {
  it.each(["a@nmkr.io", "A@NMKR.IO", "patrick@nmkr.io"])(
    "allows nmkr.io email %s",
    (email) => {
      expect(isHermesBetaAccessEmail(email)).toBe(true);
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
    expect(isHermesBetaAccessEmail(email)).toBe(false);
  });

  it("denies null and undefined", () => {
    expect(isHermesBetaAccessEmail(null)).toBe(false);
    expect(isHermesBetaAccessEmail(undefined)).toBe(false);
  });
});
