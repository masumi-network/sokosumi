import { beforeEach, describe, expect, it, vi } from "vitest";

const listAdminVendorsMock = vi.fn();
const createAdminVendorMock = vi.fn();
const patchAdminVendorMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {
    status?: number;
    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.status = options?.status;
    }
  },
  coreClient: {
    listAdminVendors: (...args: unknown[]) => listAdminVendorsMock(...args),
    createAdminVendor: (...args: unknown[]) => createAdminVendorMock(...args),
    patchAdminVendor: (...args: unknown[]) => patchAdminVendorMock(...args),
  },
}));

import { adminVendorService } from "../admin-vendor.service";

const sampleVendor = {
  id: "vendor-1",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  name: "Acme",
  slug: "acme",
  logos: { light: null, dark: null },
};

describe("adminVendorService", () => {
  beforeEach(() => {
    listAdminVendorsMock.mockReset();
    createAdminVendorMock.mockReset();
    patchAdminVendorMock.mockReset();
  });

  it("lists vendors from the admin endpoint", async () => {
    listAdminVendorsMock.mockResolvedValue({ data: [sampleVendor] });

    await expect(adminVendorService.listVendors()).resolves.toEqual([
      sampleVendor,
    ]);
  });

  it("finds a vendor by id from the list", async () => {
    listAdminVendorsMock.mockResolvedValue({ data: [sampleVendor] });

    await expect(adminVendorService.getVendorById("vendor-1")).resolves.toEqual(
      sampleVendor,
    );
    await expect(
      adminVendorService.getVendorById("missing"),
    ).resolves.toBeNull();
  });

  it("creates a vendor", async () => {
    createAdminVendorMock.mockResolvedValue({ data: sampleVendor });

    await expect(
      adminVendorService.createVendor({
        name: "Acme",
        slug: "acme",
      }),
    ).resolves.toEqual(sampleVendor);

    expect(createAdminVendorMock).toHaveBeenCalledWith({
      name: "Acme",
      slug: "acme",
    });
  });

  it("skips patch when nothing changed", async () => {
    await expect(
      adminVendorService.patchVendor("vendor-1", sampleVendor, {
        name: sampleVendor.name,
        logos: sampleVendor.logos,
      }),
    ).resolves.toEqual(sampleVendor);

    expect(patchAdminVendorMock).not.toHaveBeenCalled();
  });

  it("patches changed vendor fields", async () => {
    const updated = { ...sampleVendor, name: "Acme Updated" };
    patchAdminVendorMock.mockResolvedValue({ data: updated });

    await expect(
      adminVendorService.patchVendor("vendor-1", sampleVendor, {
        name: "Acme Updated",
        logos: { light: "https://example.com/light.png", dark: null },
      }),
    ).resolves.toEqual(updated);

    expect(patchAdminVendorMock).toHaveBeenCalledWith("vendor-1", {
      name: "Acme Updated",
      logos: { light: "https://example.com/light.png" },
    });
  });
});
