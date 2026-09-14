import { describe, expect, it, vi } from "vitest";
import { createAuthOrganizationPlugin } from "./auth-organization";

const { ensurePersonalWorkspace, guardOrganizationCreate } = vi.hoisted(() => ({
  ensurePersonalWorkspace: vi.fn(),
  guardOrganizationCreate: vi.fn((organization) => organization),
}));

vi.mock("@/helpers/org-membership-personal-workspace", () => ({
  ensurePersonalWorkspaceForOrganizationMembership: ensurePersonalWorkspace,
  pinPreferredOrganizationIfUnset: vi.fn(),
}));
vi.mock("@/helpers/design-md-metadata-auth", () => ({
  applyDesignMdMetadataGuardToOrganizationCreate: guardOrganizationCreate,
  applyDesignMdMetadataGuardToOrganizationUpdate: vi.fn(),
}));

const organization = { name: "Workspace", slug: "workspace" };
const user = {
  id: "user-1",
  name: "Owner",
  email: "owner@example.com",
  emailVerified: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

describe("organization auth creation", () => {
  it("checks the personal workspace before applying organization metadata", async () => {
    vi.clearAllMocks();
    ensurePersonalWorkspace.mockResolvedValue(undefined);
    const hooks = createAuthOrganizationPlugin().options.organizationHooks;

    await expect(
      hooks.beforeCreateOrganization({ organization, user }),
    ).resolves.toEqual({ data: organization });

    expect(ensurePersonalWorkspace).toHaveBeenCalledWith(user.id);
    expect(guardOrganizationCreate).toHaveBeenCalledWith(organization);
    expect(ensurePersonalWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      guardOrganizationCreate.mock.invocationCallOrder[0],
    );
  });

  it("propagates workspace failure before processing organization metadata", async () => {
    vi.clearAllMocks();
    const error = new Error("Workspace unavailable");
    ensurePersonalWorkspace.mockRejectedValue(error);
    const hooks = createAuthOrganizationPlugin().options.organizationHooks;

    await expect(
      hooks.beforeCreateOrganization({ organization, user }),
    ).rejects.toBe(error);
    expect(guardOrganizationCreate).not.toHaveBeenCalled();
  });
});
