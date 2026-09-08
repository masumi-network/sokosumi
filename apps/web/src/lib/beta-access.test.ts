import { describe, expect, it } from "vitest";

import {
  hasCalendarBetaAccess,
  isSokoBotBetaAccessEmail,
} from "@/lib/beta-access";

describe("isSokoBotBetaAccessEmail", () => {
  it.each(["a@nmkr.io", "A@NMKR.IO", "patrick@nmkr.io"])(
    "allows nmkr.io email %s",
    (email) => {
      expect(isSokoBotBetaAccessEmail(email)).toBe(true);
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
    expect(isSokoBotBetaAccessEmail(email)).toBe(false);
  });

  it("denies null and undefined", () => {
    expect(isSokoBotBetaAccessEmail(null)).toBe(false);
    expect(isSokoBotBetaAccessEmail(undefined)).toBe(false);
  });
});

describe("hasCalendarBetaAccess", () => {
  it("allows membership in the utxo AG workspace", () => {
    expect(
      hasCalendarBetaAccess([
        { organization: { slug: "other" } },
        { organization: { slug: "utxo" } },
      ]),
    ).toBe(true);
  });

  it("denies users without an utxo AG workspace membership", () => {
    expect(hasCalendarBetaAccess([{ organization: { slug: "other" } }])).toBe(
      false,
    );
    expect(hasCalendarBetaAccess([])).toBe(false);
  });
});
