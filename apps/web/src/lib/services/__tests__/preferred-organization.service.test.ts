import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.shared";

export {};

vi.mock("server-only", () => ({}));

const getMyPreferredOrganizationMock = vi.fn();
const patchMyPreferredOrganizationMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError,
  coreClient: {
    getMyPreferredOrganization: (...args: unknown[]) =>
      getMyPreferredOrganizationMock(...args),
    patchMyPreferredOrganization: (...args: unknown[]) =>
      patchMyPreferredOrganizationMock(...args),
  },
}));

describe("preferredOrganizationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the preferred organization for a new session when membership is still valid", async () => {
    getMyPreferredOrganizationMock.mockResolvedValue({
      data: { organizationId: "org-1" },
    });

    const { preferredOrganizationService } = await import(
      "../preferred-organization.service"
    );
    const result =
      await preferredOrganizationService.resolveActiveOrganizationIdForSession(
        "user-1",
      );

    expect(result).toBe("org-1");
    expect(getMyPreferredOrganizationMock).toHaveBeenCalled();
  });

  it("returns null when there is no stored preferred organization", async () => {
    getMyPreferredOrganizationMock.mockResolvedValue({
      data: { organizationId: null },
    });

    const { preferredOrganizationService } = await import(
      "../preferred-organization.service"
    );
    const result =
      await preferredOrganizationService.resolveActiveOrganizationIdForSession(
        "user-1",
      );

    expect(result).toBeNull();
  });

  it("returns null for a stale preferred organization when membership was removed", async () => {
    getMyPreferredOrganizationMock.mockResolvedValue({
      data: { organizationId: null },
    });

    const { preferredOrganizationService } = await import(
      "../preferred-organization.service"
    );
    const result =
      await preferredOrganizationService.resolveActiveOrganizationIdForSession(
        "user-1",
      );

    expect(result).toBeNull();
    expect(getMyPreferredOrganizationMock).toHaveBeenCalled();
  });

  it("persists a personal workspace preference without checking membership", async () => {
    patchMyPreferredOrganizationMock.mockResolvedValue({
      data: { organizationId: null },
    });

    const { preferredOrganizationService } = await import(
      "../preferred-organization.service"
    );
    const result =
      await preferredOrganizationService.persistPreferredOrganizationId(
        "user-1",
        null,
      );

    expect(result).toEqual({
      ok: true,
      organizationId: null,
    });
    expect(patchMyPreferredOrganizationMock).toHaveBeenCalledWith(null);
  });

  it("persists an organization preference when the user is a member", async () => {
    patchMyPreferredOrganizationMock.mockResolvedValue({
      data: { organizationId: "org-1" },
    });

    const { preferredOrganizationService } = await import(
      "../preferred-organization.service"
    );
    const result =
      await preferredOrganizationService.persistPreferredOrganizationId(
        "user-1",
        "org-1",
      );

    expect(result).toEqual({
      ok: true,
      organizationId: "org-1",
    });
    expect(patchMyPreferredOrganizationMock).toHaveBeenCalledWith("org-1");
  });

  it("rejects persisting an organization preference when the user is not a member", async () => {
    patchMyPreferredOrganizationMock.mockRejectedValue(
      new CoreApiRequestError("You are not a member of this organization", {
        status: 400,
      }),
    );

    const { preferredOrganizationService } = await import(
      "../preferred-organization.service"
    );
    const result =
      await preferredOrganizationService.persistPreferredOrganizationId(
        "user-1",
        "org-1",
      );

    expect(result).toEqual({
      ok: false,
      organizationId: null,
    });
  });
});
