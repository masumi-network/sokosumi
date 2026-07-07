import { describe, expect, it } from "vitest";

import { inferStripeTaxIdTypeForCountry } from "@/lib/stripe-tax-id";

describe("inferStripeTaxIdTypeForCountry", () => {
  it("maps EU countries to eu_vat", () => {
    expect(inferStripeTaxIdTypeForCountry("de")).toBe("eu_vat");
    expect(inferStripeTaxIdTypeForCountry("FR")).toBe("eu_vat");
  });

  it("maps known non-EU countries", () => {
    expect(inferStripeTaxIdTypeForCountry("GB")).toBe("gb_vat");
    expect(inferStripeTaxIdTypeForCountry("US")).toBe("us_ein");
  });

  it("returns null for unsupported countries", () => {
    expect(inferStripeTaxIdTypeForCountry("XX")).toBeNull();
  });
});
