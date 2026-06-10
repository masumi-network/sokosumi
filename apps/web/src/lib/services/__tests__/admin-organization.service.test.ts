import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  searchAdminOrganizationsMock,
  getAdminOrganizationBySlugMock,
  MockCoreApiRequestError,
} = vi.hoisted(() => {
  class MockCoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  }

  return {
    searchAdminOrganizationsMock: vi.fn(),
    getAdminOrganizationBySlugMock: vi.fn(),
    MockCoreApiRequestError,
  };
});

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    searchAdminOrganizations: (...args: unknown[]) =>
      searchAdminOrganizationsMock(...args),
    getAdminOrganizationBySlug: (...args: unknown[]) =>
      getAdminOrganizationBySlugMock(...args),
  },
  CoreApiRequestError: MockCoreApiRequestError,
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
    it("returns the mapped option when core returns one", async () => {
      getAdminOrganizationBySlugMock.mockResolvedValue({
        data: { id: "o1", name: "Acme", slug: "acme", extra: "ignored" },
      });

      const result =
        await adminOrganizationService.getOrganizationOptionBySlug("acme");

      expect(getAdminOrganizationBySlugMock).toHaveBeenCalledWith("acme");
      expect(result).toEqual({ id: "o1", name: "Acme", slug: "acme" });
    });

    it("returns null when core responds 404", async () => {
      getAdminOrganizationBySlugMock.mockRejectedValue(
        new MockCoreApiRequestError("Not Found", { status: 404 }),
      );

      const result =
        await adminOrganizationService.getOrganizationOptionBySlug("missing");

      expect(result).toBeNull();
    });

    it("rethrows non-404 core errors", async () => {
      getAdminOrganizationBySlugMock.mockRejectedValue(
        new MockCoreApiRequestError("Boom", { status: 500 }),
      );

      await expect(
        adminOrganizationService.getOrganizationOptionBySlug("acme"),
      ).rejects.toThrow("Boom");
    });
  });
});
