import {
  parseLastUsedAuthMethod,
  type LastUsedAuthMethod,
} from "@/lib/utils/last-used-auth-method";

describe("parseLastUsedAuthMethod", () => {
  it.each<LastUsedAuthMethod>([
    "google",
    "microsoft",
    "magic-link",
    "email",
  ])("returns %s for supported values", (value) => {
    expect(parseLastUsedAuthMethod(value)).toBe(value);
  });

  it("returns null for unknown values", () => {
    expect(parseLastUsedAuthMethod("github")).toBeNull();
    expect(parseLastUsedAuthMethod(undefined)).toBeNull();
  });
});
