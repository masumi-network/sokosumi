import { describe, expect, it } from "vitest";
import { accountChipLabel } from "./social-post-account-chip-label";

describe("accountChipLabel", () => {
  it("prefers the account name over the handle", () => {
    expect(
      accountChipLabel(
        { displayName: "Sokosumi HQ", externalHandle: "sokosumi" },
        "Unknown account",
      ),
    ).toBe("Sokosumi HQ");
  });

  it("keeps a formatted handle when there is no name", () => {
    expect(
      accountChipLabel(
        { displayName: null, externalHandle: "sokosumi-co" },
        "Unknown account",
      ),
    ).toBe("@sokosumi-co");
  });
});
