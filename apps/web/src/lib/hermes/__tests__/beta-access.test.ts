import { describe, expect, it } from "vitest";

import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";

describe("isHermesBetaAccessEmail", () => {
  it("matches allowed beta domains only", () => {
    expect(isHermesBetaAccessEmail("a@nmkr.io")).toBe(true);
    expect(isHermesBetaAccessEmail("a@house-of-communication.com")).toBe(true);
    expect(isHermesBetaAccessEmail("a@sub.nmkr.io")).toBe(false);
    expect(isHermesBetaAccessEmail(null)).toBe(false);
    expect(isHermesBetaAccessEmail("not-an-email")).toBe(false);
  });
});
