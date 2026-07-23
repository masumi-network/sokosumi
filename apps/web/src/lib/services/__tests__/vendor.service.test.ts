import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listMyVendorMembershipsMock = vi.fn();
const listVendorMembersMock = vi.fn();
const listCoworkerAssignmentsMock = vi.fn();
const patchVendorMock = vi.fn();
const assignCoworkerDeveloperMock = vi.fn();
const unassignCoworkerDeveloperMock = vi.fn();
const getOwnedCoworkersMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    listMyVendorMemberships: (...args: unknown[]) =>
      listMyVendorMembershipsMock(...args),
    listVendorMembers: (...args: unknown[]) => listVendorMembersMock(...args),
    listCoworkerAssignments: (...args: unknown[]) =>
      listCoworkerAssignmentsMock(...args),
    patchVendor: (...args: unknown[]) => patchVendorMock(...args),
    assignCoworkerDeveloper: (...args: unknown[]) =>
      assignCoworkerDeveloperMock(...args),
    unassignCoworkerDeveloper: (...args: unknown[]) =>
      unassignCoworkerDeveloperMock(...args),
    getOwnedCoworkers: (...args: unknown[]) => getOwnedCoworkersMock(...args),
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

const coworker = {
  id: "cow_1",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-02T00:00:00.000Z"),
  archivedAt: null,
  userId: "user_owner",
  vendorId: "vendor_1",
  slug: "ops-agent",
  name: "Ops Agent",
  caption: null,
  description: null,
  url: null,
  baseURL: null,
  capabilities: [],
  image: null,
  priority: 0,
  isWhitelisted: false,
  metadata: null,
  vendor: {
    id: "vendor_1",
    name: "Serviceplan",
    slug: "serviceplan",
  },
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
    listVendorMembersMock.mockResolvedValue({
      data: [
        {
          id: "dev_1",
          email: "dev@example.com",
          name: "Dev",
          role: VendorMemberRole.DEVELOPER,
        },
      ],
    });
    getOwnedCoworkersMock.mockResolvedValue({ data: [coworker] });
    listCoworkerAssignmentsMock.mockResolvedValue({
      data: [
        {
          coworkerId: coworker.id,
          userId: "dev_1",
          createdAt: new Date("2025-01-03T00:00:00.000Z"),
          updatedAt: new Date("2025-01-03T00:00:00.000Z"),
        },
      ],
    });

    const result = await vendorService.getVendorAdminPanelData("vendor_1");

    expect(result?.vendor.id).toBe("vendor_1");
    expect(result?.developerMembers).toHaveLength(1);
    expect(result?.coworkerAssignments).toHaveLength(1);
  });

  it("returns null for vendor admin panel when user is not vendor admin", async () => {
    listMyVendorMembershipsMock.mockResolvedValue({ data: [developerVendor] });

    const result = await vendorService.getVendorAdminPanelData("vendor_2");

    expect(result).toBeNull();
  });
});
