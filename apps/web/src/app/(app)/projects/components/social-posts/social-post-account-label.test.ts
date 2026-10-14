import { describe, expect, it } from "vitest";
import { socialPostAccountLabel } from "./social-post-account-label";

describe("socialPostAccountLabel", () => {
  it("prefers the account name over the handle", () => {
    expect(
      socialPostAccountLabel(
        { displayName: "Sokosumi HQ", externalHandle: "sokosumi" },
        "No account",
      ),
    ).toBe("Sokosumi HQ");
  });

  it("keeps a formatted handle when there is no name", () => {
    expect(
      socialPostAccountLabel(
        { displayName: null, externalHandle: "sokosumi" },
        "No account",
      ),
    ).toBe("@sokosumi");
  });

  it("uses the fallback when the row has no account", () => {
    expect(socialPostAccountLabel(null, "No account")).toBe("No account");
  });
});
