import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTagMock = vi.fn();
const getMyCreditsMock = vi.fn();

vi.mock("next/cache", () => ({
  updateTag: (...args: unknown[]) => updateTagMock(...args),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getMyCredits: (...args: unknown[]) => getMyCreditsMock(...args),
  },
}));

describe("private-sidebar-cache", () => {
  beforeEach(() => {
    updateTagMock.mockReset();
    getMyCreditsMock.mockReset();
  });

  it("builds stable user and org tags", async () => {
    const { privateSidebarOrgTag, privateSidebarUserTag } = await import(
      "../private-sidebar-cache"
    );

    expect(privateSidebarUserTag("user-1")).toBe("app-sidebar-user-user-1");
    expect(privateSidebarOrgTag("org-1")).toBe("app-sidebar-org-org-1");
  });

  it("invalidates user tag and current + previous org tags", async () => {
    const { invalidatePrivateSidebarChrome } = await import(
      "../private-sidebar-cache"
    );

    invalidatePrivateSidebarChrome({
      userId: "user-1",
      organizationId: "org-new",
      previousOrganizationId: "org-old",
    });

    expect(updateTagMock).toHaveBeenCalledWith("app-sidebar-user-user-1");
    expect(updateTagMock).toHaveBeenCalledWith("app-sidebar-org-org-new");
    expect(updateTagMock).toHaveBeenCalledWith("app-sidebar-org-org-old");
  });

  it("skips duplicate previous org when unchanged", async () => {
    const { invalidatePrivateSidebarChrome } = await import(
      "../private-sidebar-cache"
    );

    invalidatePrivateSidebarChrome({
      userId: "user-1",
      organizationId: "org-1",
      previousOrganizationId: "org-1",
    });

    expect(updateTagMock).toHaveBeenCalledTimes(2);
    expect(updateTagMock).toHaveBeenCalledWith("app-sidebar-user-user-1");
    expect(updateTagMock).toHaveBeenCalledWith("app-sidebar-org-org-1");
  });

  it("returns null when credits fetch fails", async () => {
    getMyCreditsMock.mockRejectedValueOnce(new Error("boom"));
    const { getCachedMyCredits } = await import("../private-sidebar-cache");

    await expect(getCachedMyCredits()).resolves.toBeNull();
  });
});
