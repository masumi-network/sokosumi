import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listMyVendorMembershipsMock = vi.fn();
const patchVendorMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    listMyVendorMemberships: (...args: unknown[]) =>
      listMyVendorMembershipsMock(...args),
    patchVendor: (...args: unknown[]) => patchVendorMock(...args),
  },
}));

import { VendorMemberRole } from "@/lib/clients/generated/core";
import { vendorService } from "../vendor.service";

const adminVendor = {
  id: "vendor_1",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-02T00:00:00.000Z"),
  name: "Serviceplan",
  slug: "serviceplan",
  logos: { light: "/light.png", dark: "/dark.png" },
  role: VendorMemberRole.ADMIN,
};

const developerVendor = {
  ...adminVendor,
  id: "vendor_2",
  role: VendorMemberRole.DEVELOPER,
};

describe("vendorService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only admin vendor memberships", async () => {
    listMyVendorMembershipsMock.mockResolvedValue({
      data: [adminVendor, developerVendor],
    });

    const result = await vendorService.listMyAdminVendorMemberships();

    expect(result).toEqual([adminVendor]);
  });

  it("omits unchanged fields when patching vendor profile", async () => {
    patchVendorMock.mockResolvedValue({
      data: {
        ...adminVendor,
        logos: { light: "/new-light.png", dark: "/dark.png" },
      },
    });

    await vendorService.patchVendorProfile(
      adminVendor.id,
      {
        id: adminVendor.id,
        createdAt: adminVendor.createdAt,
        updatedAt: adminVendor.updatedAt,
        name: adminVendor.name,
        slug: adminVendor.slug,
        logos: adminVendor.logos,
      },
      {
        name: adminVendor.name,
        logos: { light: "/new-light.png" },
      },
    );

    expect(patchVendorMock).toHaveBeenCalledWith("vendor_1", {
      logos: { light: "/new-light.png" },
    });
  });

  it("skips patch call when nothing changed", async () => {
    const result = await vendorService.patchVendorProfile(
      adminVendor.id,
      {
        id: adminVendor.id,
        createdAt: adminVendor.createdAt,
        updatedAt: adminVendor.updatedAt,
        name: adminVendor.name,
        slug: adminVendor.slug,
        logos: adminVendor.logos,
      },
      {
        name: adminVendor.name,
        logos: adminVendor.logos,
      },
    );

    expect(patchVendorMock).not.toHaveBeenCalled();
    expect(result.name).toBe(adminVendor.name);
  });

  it("loads vendor admin panel data for admin vendors only", async () => {
    listMyVendorMembershipsMock.mockResolvedValue({ data: [adminVendor] });

    const result = await vendorService.getVendorAdminPanelData("vendor_1");

    expect(result).toEqual({ vendor: adminVendor });
  });

  it("returns null for vendor admin panel when user is not vendor admin", async () => {
    listMyVendorMembershipsMock.mockResolvedValue({ data: [developerVendor] });

    const result = await vendorService.getVendorAdminPanelData("vendor_2");

    expect(result).toBeNull();
  });
});
