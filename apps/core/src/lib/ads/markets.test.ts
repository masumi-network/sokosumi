import { describe, expect, it } from "vitest";

import {
  AD_MARKET_LOCATIONS,
  countryCodeOfLocation,
  isAdMarketLanguage,
} from "./markets";

describe("ad markets", () => {
  it.each(Object.entries(AD_MARKET_LOCATIONS))(
    "maps %s to location %i and back",
    (country, location) => {
      expect(countryCodeOfLocation(location)).toBe(country);
    },
  );

  it("has no location for an unsupported code", () => {
    expect(countryCodeOfLocation(1)).toBeNull();
  });

  it("accepts only supported languages", () => {
    expect(isAdMarketLanguage("de")).toBe(true);
    expect(isAdMarketLanguage("xx")).toBe(false);
    expect(isAdMarketLanguage("DE")).toBe(false);
  });
});
