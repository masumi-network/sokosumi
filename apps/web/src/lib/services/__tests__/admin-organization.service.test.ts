import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { searchAdminOrganizationsMock } = vi.hoisted(() => ({
  searchAdminOrganizationsMock: vi.fn(),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    searchAdminOrganizations: (...args: unknown[]) =>
      searchAdminOrganizationsMock(...args),
  },
  CoreApiRequestError: class extends Error {},
}));

import { adminOrganizationService } from "../admin-organization.service";

describe("adminOrganizationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("searchOrganizations", () => {
    it("maps core results to organization options", async () => {
      searchAdminOrganizationsMock.mockResolvedValue({
        data: [{ id: "o1", name: "Acme", slug: "acme", extra: "ignored" }],
      });

      const result = await adminOrganizationService.searchOrganizations("acme");

      expect(searchAdminOrganizationsMock).toHaveBeenCalledWith("acme");
      expect(result).toEqual([{ id: "o1", name: "Acme", slug: "acme" }]);
    });
  });

  describe("getOrganizationOptionBySlug", () => {
    it("returns the exact slug match from search results", async () => {
      searchAdminOrganizationsMock.mockResolvedValue({
        data: [
          { id: "o1", name: "Acme", slug: "acme" },
          { id: "o2", name: "Acme Labs", slug: "acme-labs" },
        ],
      });

      const result =
        await adminOrganizationService.getOrganizationOptionBySlug("acme");

      expect(searchAdminOrganizationsMock).toHaveBeenCalledWith("acme");
      expect(result).toEqual({ id: "o1", name: "Acme", slug: "acme" });
    });

    it("returns null when search has no exact slug match", async () => {
      searchAdminOrganizationsMock.mockResolvedValue({
        data: [{ id: "o2", name: "Acme Labs", slug: "acme-labs" }],
      });

      const result =
        await adminOrganizationService.getOrganizationOptionBySlug("missing");

      expect(result).toBeNull();
    });

    it("rethrows search errors", async () => {
      searchAdminOrganizationsMock.mockRejectedValue(new Error("Boom"));

      await expect(
        adminOrganizationService.getOrganizationOptionBySlug("acme"),
      ).rejects.toThrow("Boom");
    });
  });
});
