import { describe, expect, it } from "vitest";

import { hasStripeBillingAddressWithCountry } from "../stripe-billing-address";

describe("hasStripeBillingAddressWithCountry", () => {
  it("returns false when address is null or undefined", () => {
    expect(hasStripeBillingAddressWithCountry(null)).toBe(false);
    expect(hasStripeBillingAddressWithCountry(undefined)).toBe(false);
  });

  it("returns false when country is empty or whitespace", () => {
    expect(hasStripeBillingAddressWithCountry({ country: "" })).toBe(false);
    expect(hasStripeBillingAddressWithCountry({ country: "   " })).toBe(false);
  });

  it("returns true when country is set", () => {
    expect(hasStripeBillingAddressWithCountry({ country: "DE" })).toBe(true);
    expect(hasStripeBillingAddressWithCountry({ country: " US " })).toBe(true);
  });
});
