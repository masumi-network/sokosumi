import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listMyAdminVendorMembershipsMock = vi.fn();

vi.mock("@/lib/services/vendor.service", () => ({
  vendorService: {
    listMyAdminVendorMemberships: (...args: unknown[]) =>
      listMyAdminVendorMembershipsMock(...args),
  },
}));

import { getDeveloperVendorAdminAccess } from "../get-developer-vendor-admin-access";

describe("getDeveloperVendorAdminAccess", () => {
  beforeEach(() => {
    listMyAdminVendorMembershipsMock.mockReset();
  });

  it("shows vendors when the user has VendorMember admin memberships", async () => {
    listMyAdminVendorMembershipsMock.mockResolvedValue([
      { id: "vendor_1", role: "admin" },
    ]);

    await expect(getDeveloperVendorAdminAccess()).resolves.toEqual({
      showVendors: true,
      adminVendors: [{ id: "vendor_1", role: "admin" }],
    });
  });

  it("hides vendors when the user has no VendorMember admin memberships", async () => {
    listMyAdminVendorMembershipsMock.mockResolvedValue([]);

    await expect(getDeveloperVendorAdminAccess()).resolves.toEqual({
      showVendors: false,
      adminVendors: [],
    });
  });

  it("hides vendors when membership lookup fails", async () => {
    listMyAdminVendorMembershipsMock.mockRejectedValue(new Error("boom"));

    await expect(getDeveloperVendorAdminAccess()).resolves.toEqual({
      showVendors: false,
      adminVendors: [],
    });
  });
});
