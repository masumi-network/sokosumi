import { describe, expect, it } from "vitest";

import { hasSocialBetaAccess } from "@/lib/beta-access";

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
