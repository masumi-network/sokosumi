import { describe, expect, it } from "vitest";

import {
  hasSocialBetaAccess,
  hasSokoBotBetaAccess,
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

describe("hasSokoBotBetaAccess", () => {
  it("allows a verified nmkr.io user", () => {
    expect(
      hasSokoBotBetaAccess({ email: "a@nmkr.io", emailVerified: true }),
    ).toBe(true);
  });

  it("denies an unverified nmkr.io user", () => {
    expect(
      hasSokoBotBetaAccess({ email: "a@nmkr.io", emailVerified: false }),
    ).toBe(false);
  });

  it("denies a verified non-nmkr user", () => {
    expect(
      hasSokoBotBetaAccess({
        email: "someone@gmail.com",
        emailVerified: true,
      }),
    ).toBe(false);
  });

  it("denies null user and missing verified flag", () => {
    expect(hasSokoBotBetaAccess(null)).toBe(false);
    expect(hasSokoBotBetaAccess({ email: "a@nmkr.io" })).toBe(false);
    expect(
      hasSokoBotBetaAccess({ email: "a@nmkr.io", emailVerified: null }),
    ).toBe(false);
  });
});

describe("hasSocialBetaAccess", () => {
  it("allows membership in the utxo AG workspace", () => {
    expect(
      hasSocialBetaAccess([
        { organization: { slug: "other" } },
        { organization: { slug: "utxo" } },
      ]),
    ).toBe(true);
  });

  it("denies users without an utxo AG workspace membership", () => {
    expect(hasSocialBetaAccess([{ organization: { slug: "other" } }])).toBe(
      false,
    );
    expect(hasSocialBetaAccess([])).toBe(false);
  });
});
