import { describe, expect, it } from "vitest";

import { formatStripeBillingAddress } from "@/lib/billing/format-stripe-billing-address";

describe("formatStripeBillingAddress", () => {
  it("formats a complete address with localized country label", () => {
    const formatted = formatStripeBillingAddress(
      {
        line1: "123 Main St",
        line2: "Suite 4",
        city: "Berlin",
        state: null,
        postalCode: "10115",
        country: "DE",
      },
      "en",
    );

    expect(formatted).toBe("123 Main St\nSuite 4\n10115 Berlin, Germany");
  });

  it("formats partial addresses without requiring every field", () => {
    const formatted = formatStripeBillingAddress(
      {
        line1: "123 Main St",
        line2: null,
        city: "",
        state: null,
        postalCode: "",
        country: "",
      },
      "en",
    );

    expect(formatted).toBe("123 Main St");
  });

  it("uses the raw country value when it is not a two-letter code", () => {
    const formatted = formatStripeBillingAddress(
      {
        line1: "1 Remote Rd",
        line2: null,
        city: "Nowhere",
        state: null,
        postalCode: "00000",
        country: "Germany",
      },
      "en",
    );

    expect(formatted).toBe("1 Remote Rd\n00000 Nowhere, Germany");
  });
});
