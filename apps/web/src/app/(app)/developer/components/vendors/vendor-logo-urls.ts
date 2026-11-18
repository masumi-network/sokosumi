import type { VendorMembership } from "@sokosumi/core-client";

/** Logo per theme; a vendor with one logo shows it in both. */
export function getVendorLogoUrls(vendor: VendorMembership): {
  light: string | undefined;
  dark: string | undefined;
} {
  const { light, dark } = vendor.logos;
  return {
    light: light ?? dark ?? undefined,
    dark: dark ?? light ?? undefined,
  };
}
