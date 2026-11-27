import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getPreprodAccessMock } = vi.hoisted(() => ({
  getPreprodAccessMock: vi.fn(),
}));

const { searchAdminOrganizationsMock } = vi.hoisted(() => ({
  searchAdminOrganizationsMock: vi.fn(),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getAdminOrganizationPreprodAccess: (...args: unknown[]) =>
      getPreprodAccessMock(...args),
    searchAdminOrganizations: (...args: unknown[]) =>
      searchAdminOrganizationsMock(...args),
  },
  CoreApiRequestError: class extends Error {
    constructor(
      message: string,
      readonly options?: { status?: number },
    ) {
      super(message);
    }
    get status() {
      return this.options?.status;
    }
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";

import { adminOrganizationService } from "./admin-organization.service";

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

  describe("getPreprodAccess", () => {
    it("answers Core's flag and history", async () => {
      const access = { enabled: true, changes: [] };
      getPreprodAccessMock.mockResolvedValue({ data: access });

      await expect(
        adminOrganizationService.getPreprodAccess("acme"),
      ).resolves.toEqual(access);
      expect(getPreprodAccessMock).toHaveBeenCalledWith("acme");
    });

    it("answers null when Core has no such target", async () => {
      getPreprodAccessMock.mockRejectedValue(
        new CoreApiRequestError("Not found", { status: 404 }),
      );

      await expect(
        adminOrganizationService.getPreprodAccess("acme"),
      ).resolves.toBeNull();
    });

    it("rethrows any other failure", async () => {
      getPreprodAccessMock.mockRejectedValue(
        new CoreApiRequestError("Forbidden", { status: 403 }),
      );

      await expect(
        adminOrganizationService.getPreprodAccess("acme"),
      ).rejects.toThrow("Forbidden");
    });
  });
});
