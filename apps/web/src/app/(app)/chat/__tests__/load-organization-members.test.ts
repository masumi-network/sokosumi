import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getOrganizationMembersMock = vi.fn();

vi.mock("@/lib/services", () => ({
  userService: {
    getOrganizationMembers: (...args: unknown[]) =>
      getOrganizationMembersMock(...args),
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { loadOrganizationMembers } from "../load-organization-members";

describe("loadOrganizationMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty members without calling Core when organizationId is missing", async () => {
    await expect(loadOrganizationMembers(null)).resolves.toEqual({
      members: [],
      failed: false,
    });
    await expect(loadOrganizationMembers(undefined)).resolves.toEqual({
      members: [],
      failed: false,
    });
    expect(getOrganizationMembersMock).not.toHaveBeenCalled();
  });

  it("returns members on success", async () => {
    const members = [{ id: "member_1" }];
    getOrganizationMembersMock.mockResolvedValue(members);

    await expect(loadOrganizationMembers("org_1")).resolves.toEqual({
      members,
      failed: false,
    });
    expect(getOrganizationMembersMock).toHaveBeenCalledWith("org_1");
  });

  it("soft-fails CoreApiRequestError instead of throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getOrganizationMembersMock.mockRejectedValue(
      new CoreApiRequestError("An unexpected error occurred", {
        status: 500,
        kind: undefined,
      }),
    );

    await expect(loadOrganizationMembers("org_1")).resolves.toEqual({
      members: [],
      failed: true,
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("rethrows unexpected errors", async () => {
    getOrganizationMembersMock.mockRejectedValue(new Error("boom"));

    await expect(loadOrganizationMembers("org_1")).rejects.toThrow("boom");
  });
});
