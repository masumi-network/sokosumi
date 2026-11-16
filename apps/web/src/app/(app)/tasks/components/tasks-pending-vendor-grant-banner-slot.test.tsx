import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  connectionMock,
  getSessionMock,
  getMyMembersWithOrganizationsMock,
  listMyVendorGrantsMock,
  listVendorGrantsMock,
} = vi.hoisted(() => ({
  connectionMock: vi.fn(),
  getSessionMock: vi.fn(),
  getMyMembersWithOrganizationsMock: vi.fn(),
  listMyVendorGrantsMock: vi.fn(),
  listVendorGrantsMock: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: connectionMock }));
vi.mock("@/lib/auth/auth.server", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMembersWithOrganizations: getMyMembersWithOrganizationsMock,
  },
}));
vi.mock("@/lib/services/vendor-grant.service", () => ({
  vendorGrantService: {
    listMyVendorGrants: listMyVendorGrantsMock,
    listVendorGrants: listVendorGrantsMock,
  },
}));
vi.mock("./tasks-pending-vendor-grant-banner", () => ({
  TasksPendingVendorGrantBanner: () => null,
}));

import { TasksPendingVendorGrantBannerSlot } from "./tasks-pending-vendor-grant-banner-slot";

describe("TasksPendingVendorGrantBannerSlot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads nothing before the request comes", async () => {
    connectionMock.mockReturnValueOnce(new Promise(() => {}));

    void TasksPendingVendorGrantBannerSlot({
      activeOrganizationId: "org-1",
      parkedTaskCount: 0,
    });
    await Promise.resolve();

    expect(getSessionMock).not.toHaveBeenCalled();
    expect(getMyMembersWithOrganizationsMock).not.toHaveBeenCalled();
    expect(listVendorGrantsMock).not.toHaveBeenCalled();
  });
});
