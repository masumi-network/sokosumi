import { describe, expect, it } from "vitest";

import {
  buildVendorLogoContentHashPathname,
  buildVendorLogoPathname,
  buildVendorLogoPrefix,
  isOwnedVendorLogoUrl,
} from "./vendor-logo-path.js";

const VENDOR_ID = "01960001-0001-7001-8001-000000000099";

describe("buildVendorLogoPrefix", () => {
  it("returns vendors/{vendorId}/logos/", () => {
    expect(buildVendorLogoPrefix(VENDOR_ID)).toBe(
      `vendors/${VENDOR_ID}/logos/`,
    );
  });
});

describe("buildVendorLogoPathname", () => {
  it("builds a sanitized pathname under the vendor logos prefix", () => {
    expect(buildVendorLogoPathname(VENDOR_ID, " Ops Logo (1).png ")).toBe(
      `vendors/${VENDOR_ID}/logos/Ops_Logo_1.png`,
    );
  });

  it("falls back when the filename is empty after sanitizing", () => {
    expect(buildVendorLogoPathname(VENDOR_ID, "@@@")).toBe(
      `vendors/${VENDOR_ID}/logos/file`,
    );
  });
});

describe("buildVendorLogoContentHashPathname", () => {
  it("appends the sha256 hex under the vendor logos prefix", () => {
    const hash =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(buildVendorLogoContentHashPathname(VENDOR_ID, hash)).toBe(
      `vendors/${VENDOR_ID}/logos/${hash}`,
    );
  });
});

describe("isOwnedVendorLogoUrl", () => {
  it("accepts https Vercel blob URLs under the vendor logos prefix", () => {
    expect(
      isOwnedVendorLogoUrl(
        `https://abc.public.blob.vercel-storage.com/vendors/${VENDOR_ID}/logos/logo-xyz.png`,
        VENDOR_ID,
      ),
    ).toBe(true);
  });

  it("rejects foreign hosts, wrong prefix, flat legacy path, and non-https URLs", () => {
    expect(
      isOwnedVendorLogoUrl(
        `https://evil.example.com/vendors/${VENDOR_ID}/logos/logo.png`,
        VENDOR_ID,
      ),
    ).toBe(false);
    expect(
      isOwnedVendorLogoUrl(
        `https://abc.public.blob.vercel-storage.com/organizations/${VENDOR_ID}/logos/logo.png`,
        VENDOR_ID,
      ),
    ).toBe(false);
    expect(
      isOwnedVendorLogoUrl(
        `https://abc.public.blob.vercel-storage.com/vendors/${VENDOR_ID}/logo.png`,
        VENDOR_ID,
      ),
    ).toBe(false);
    expect(
      isOwnedVendorLogoUrl(
        "https://abc.public.blob.vercel-storage.com/vendor-logos/abcdef",
        VENDOR_ID,
      ),
    ).toBe(false);
    expect(
      isOwnedVendorLogoUrl(
        `http://abc.public.blob.vercel-storage.com/vendors/${VENDOR_ID}/logos/logo.png`,
        VENDOR_ID,
      ),
    ).toBe(false);
    expect(isOwnedVendorLogoUrl("not-a-url", VENDOR_ID)).toBe(false);
  });
});
