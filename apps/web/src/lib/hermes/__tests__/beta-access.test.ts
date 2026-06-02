import { describe, expect, it } from "vitest";

import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";

describe("isHermesBetaAccessEmail", () => {
  it("matches allowed beta domains only", () => {
    expect(isHermesBetaAccessEmail("a@nmkr.io")).toBe(true);
    expect(isHermesBetaAccessEmail("a@sub.nmkr.io")).toBe(false);
    expect(isHermesBetaAccessEmail(null)).toBe(false);
    expect(isHermesBetaAccessEmail("not-an-email")).toBe(false);
  });

  it.each([
    "k.platz@house-of-communication.com",
    "y.bollinger@house-of-communication.com",
    "s.kuepers@house-of-communication.com",
    "m.starkova@house-of-communication.com",
    "K.PLATZ@HOUSE-OF-COMMUNICATION.COM",
  ])("allows House of Communication pilot email %s", (email) => {
    expect(isHermesBetaAccessEmail(email)).toBe(true);
  });

  it("denies other House of Communication emails", () => {
    expect(isHermesBetaAccessEmail("someone@house-of-communication.com")).toBe(
      false,
    );
  });
});
