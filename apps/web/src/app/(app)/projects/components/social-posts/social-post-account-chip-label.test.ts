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

  it("trims the account name", () => {
    expect(
      accountChipLabel(
        { displayName: "  Sokosumi HQ  ", externalHandle: "sokosumi" },
        "No account",
      ),
    ).toBe("Sokosumi HQ");
  });

  it("falls back to the handle when the name is whitespace only", () => {
    expect(
      accountChipLabel(
        { displayName: " \t\n ", externalHandle: "sokosumi" },
        "No account",
      ),
    ).toBe("@sokosumi");
  });

  it("uses the fallback when both fields are missing", () => {
    expect(
      accountChipLabel(
        { displayName: null, externalHandle: null },
        "No account",
      ),
    ).toBe("No account");
  });

  it("does not double the leading @ on a handle", () => {
    expect(
      accountChipLabel(
        { displayName: null, externalHandle: "@sokosumi" },
        "No account",
      ),
    ).toBe("@sokosumi");
  });

  it.each([null, undefined])(
    "uses the fallback for a %s account",
    (connection) => {
      expect(accountChipLabel(connection, "No account")).toBe("No account");
    },
  );
});
