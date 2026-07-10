export const TEST_VENDOR_ID = "01960001-0001-7001-8001-000000000001";

export const testVendorLogos = {
  light: "/images/logos/serviceplan-logo.png",
  dark: "/images/logos/serviceplan-logo-white.png",
} as const;

export const testVendor = {
  id: TEST_VENDOR_ID,
  createdAt: new Date("2026-02-25T10:00:00.000Z"),
  updatedAt: new Date("2026-02-25T10:00:00.000Z"),
  name: "Serviceplan",
  slug: "serviceplan",
  logoLight: testVendorLogos.light,
  logoDark: testVendorLogos.dark,
};

export const testVendorApi = {
  id: TEST_VENDOR_ID,
  name: "Serviceplan",
  slug: "serviceplan",
  logos: {
    light: testVendorLogos.light,
    dark: testVendorLogos.dark,
  },
};

export const emptyVendorLogos = {
  light: null,
  dark: null,
} as const;
