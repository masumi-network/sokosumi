import { beforeEach, describe, expect, it, vi } from "vitest";

import { updatePreferredOrganization } from "@/lib/actions/organization";
import {
  activateOrganizationWorkspace,
  activateOrganizationWorkspaceWithRetry,
} from "@/lib/activate-organization-workspace";
import { authClient } from "@/lib/auth/auth.client";

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    organization: {
      setActive: vi.fn(),
    },
  },
}));

vi.mock("@/lib/actions/organization", () => ({
  updatePreferredOrganization: vi.fn(),
}));

describe("activateOrganizationWorkspace", () => {
  beforeEach(() => {
    vi.mocked(authClient.organization.setActive).mockReset();
    vi.mocked(updatePreferredOrganization).mockReset();
  });

  it("sets the active organization and persists it as preferred", async () => {
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: true,
      value: {
        organizationId: "org-7",
      },
    });

    await activateOrganizationWorkspace("org-7");

    expect(authClient.organization.setActive).toHaveBeenCalledWith({
      organizationId: "org-7",
    });
    expect(updatePreferredOrganization).toHaveBeenCalledWith({
      organizationId: "org-7",
    });
  });

  it("activates the personal workspace when given null", async () => {
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: true,
      value: {
        organizationId: null,
      },
    });

    await activateOrganizationWorkspace(null);

    expect(authClient.organization.setActive).toHaveBeenCalledWith({
      organizationId: null,
    });
    expect(updatePreferredOrganization).toHaveBeenCalledWith({
      organizationId: null,
    });
  });

  it("does not persist preferred organization when setActive returns an error", async () => {
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: {
        message: "ORGANIZATION_NOT_FOUND",
      },
    });

    await expect(activateOrganizationWorkspace("org-7")).rejects.toThrow(
      "ORGANIZATION_NOT_FOUND",
    );
    expect(updatePreferredOrganization).not.toHaveBeenCalled();
  });

  it("still resolves when persisting the preferred organization fails", async () => {
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
      },
    });

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      activateOrganizationWorkspace("org-7"),
    ).resolves.toBeUndefined();

    expect(authClient.organization.setActive).toHaveBeenCalledWith({
      organizationId: "org-7",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to persist preferred organization:",
      {
        code: "UNAUTHORIZED",
      },
    );

    consoleErrorSpy.mockRestore();
  });

  it("retries setActive once and reports failure after two errors", async () => {
    vi.mocked(authClient.organization.setActive).mockResolvedValue({
      data: null,
      error: { message: "setActive failed" },
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(activateOrganizationWorkspaceWithRetry("org-7")).resolves.toBe(
      false,
    );

    expect(authClient.organization.setActive).toHaveBeenCalledTimes(2);
    consoleErrorSpy.mockRestore();
  });

  it("succeeds on the second setActive attempt", async () => {
    vi.mocked(authClient.organization.setActive)
      .mockResolvedValueOnce({
        data: null,
        error: { message: "setActive failed" },
      })
      .mockResolvedValueOnce({
        data: null,
        error: null,
      });
    vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: true,
      value: { organizationId: "org-7" },
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(activateOrganizationWorkspaceWithRetry("org-7")).resolves.toBe(
      true,
    );

    expect(authClient.organization.setActive).toHaveBeenCalledTimes(2);
    consoleErrorSpy.mockRestore();
  });
});
