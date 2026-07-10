import type { Coworker, Vendor } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

export function mockVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: "01960001-0001-7001-8001-000000000001",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    name: "Serviceplan",
    slug: "serviceplan",
    logos: {
      light: "/images/logos/serviceplan-logo.png",
      dark: "/images/logos/serviceplan-logo-white.png",
    },
    ...overrides,
  };
}

export function mockVendorPick(
  overrides: Partial<CoworkerOption["vendor"]> = {},
): CoworkerOption["vendor"] {
  const vendor = mockVendor();
  return {
    id: vendor.id,
    name: vendor.name,
    slug: vendor.slug,
    logos: vendor.logos,
    ...overrides,
  };
}

export function mockCoworkerOption(
  overrides: Partial<CoworkerOption> = {},
): CoworkerOption {
  return {
    id: "coworker-1",
    slug: "elena",
    name: "Elena",
    image: "",
    vendor: mockVendorPick(),
    ...overrides,
  };
}

export function mockCoreCoworker(overrides: Partial<Coworker> = {}): Coworker {
  return {
    id: "cow_1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    isWhitelisted: true,
    priority: 0,
    slug: "ops-agent",
    name: "Ops Agent",
    baseURL: null,
    vendor: mockVendor(),
    capabilities: ["tasks"],
    metadata: null,
    ...overrides,
  };
}
