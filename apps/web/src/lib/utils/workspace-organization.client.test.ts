import { beforeEach, describe, expect, it, vi } from "vitest";

const getWorkspaceOrganizationIdMock = vi.fn();

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getWorkspaceOrganizationId: (...args: unknown[]) =>
      getWorkspaceOrganizationIdMock(...args),
  },
}));

import { getWorkspaceOrganizationId } from "@/lib/utils/workspace-organization.client";

describe("getWorkspaceOrganizationId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the organization id from Core", async () => {
    getWorkspaceOrganizationIdMock.mockResolvedValueOnce({
      data: { organizationId: "org_1" },
    });

    await expect(getWorkspaceOrganizationId("ws_fetch")).resolves.toBe("org_1");
    expect(getWorkspaceOrganizationIdMock).toHaveBeenCalledWith("ws_fetch");
  });

  it("reuses the in-module cache on a later call", async () => {
    getWorkspaceOrganizationIdMock.mockResolvedValueOnce({
      data: { organizationId: "org_cached" },
    });

    await expect(getWorkspaceOrganizationId("ws_cache")).resolves.toBe(
      "org_cached",
    );
    await expect(getWorkspaceOrganizationId("ws_cache")).resolves.toBe(
      "org_cached",
    );
    expect(getWorkspaceOrganizationIdMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed lookup", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    getWorkspaceOrganizationIdMock
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({
        data: { organizationId: "org_retry" },
      });

    await expect(
      getWorkspaceOrganizationId("ws_fail"),
    ).resolves.toBeUndefined();
    await expect(getWorkspaceOrganizationId("ws_fail")).resolves.toBe(
      "org_retry",
    );
    expect(getWorkspaceOrganizationIdMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});
