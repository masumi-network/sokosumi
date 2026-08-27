import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getCoworkersMock = vi.fn();
const getCoworkerByIdMock = vi.fn();
const patchCoworkerMock = vi.fn();
const patchCoworkerWhitelistMock = vi.fn();
const archiveCoworkerMock = vi.fn();
const unarchiveCoworkerMock = vi.fn();
const uploadCoworkerImageMock = vi.fn();
const deleteCoworkerImageMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  },
  coreClient: {
    getCoworkers: (...args: unknown[]) => getCoworkersMock(...args),
    getCoworkerById: (...args: unknown[]) => getCoworkerByIdMock(...args),
    patchCoworker: (...args: unknown[]) => patchCoworkerMock(...args),
    patchCoworkerWhitelist: (...args: unknown[]) =>
      patchCoworkerWhitelistMock(...args),
    archiveCoworker: (...args: unknown[]) => archiveCoworkerMock(...args),
    unarchiveCoworker: (...args: unknown[]) => unarchiveCoworkerMock(...args),
    uploadCoworkerImage: (...args: unknown[]) =>
      uploadCoworkerImageMock(...args),
    deleteCoworkerImage: (...args: unknown[]) =>
      deleteCoworkerImageMock(...args),
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";

import { adminCoworkerService } from "./admin-coworker.service";

const coworker = {
  id: "cow_1",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-02T00:00:00.000Z"),
  archivedAt: null,
  userId: "user_owner",
  vendorId: "vendor_1",
  slug: "ops-agent",
  name: "Ops Agent",
  caption: "Ops caption",
  description: "Ops description",
  url: null,
  baseURL: null,
  capabilities: [],
  image: "https://example.com/image.png",
  priority: 0,
  isWhitelisted: false,
  metadata: null,
  vendor: {
    id: "vendor_1",
    name: "Vendor",
    slug: "vendor",
  },
};

const archivedCoworker = {
  ...coworker,
  id: "cow_2",
  name: "Archived Agent",
  slug: "archived-agent",
  createdAt: new Date("2025-02-01T00:00:00.000Z"),
  archivedAt: new Date("2025-02-01T00:00:00.000Z"),
};

describe("adminCoworkerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists active and archived coworkers merged", async () => {
    getCoworkersMock
      .mockResolvedValueOnce({ data: [coworker] })
      .mockResolvedValueOnce({ data: [archivedCoworker] });

    const result = await adminCoworkerService.listCoworkers();

    expect(getCoworkersMock).toHaveBeenNthCalledWith(1, { scope: "all" });
    expect(getCoworkersMock).toHaveBeenNthCalledWith(2, { scope: "archived" });
    expect(result).toEqual([archivedCoworker, coworker]);
  });

  it("returns null when coworker is missing", async () => {
    getCoworkerByIdMock.mockRejectedValue(
      new CoreApiRequestError("Not found", { status: 404 }),
    );

    const result = await adminCoworkerService.getCoworkerById("cow_1");

    expect(result).toBeNull();
  });

  it("updates controls via patch", async () => {
    patchCoworkerMock.mockResolvedValue({
      data: { ...coworker, priority: 5, capabilities: ["chat", "tasks"] },
    });

    const result = await adminCoworkerService.updateControls("cow_1", {
      priority: 5,
      capabilities: ["chat", "tasks"],
    });

    expect(patchCoworkerMock).toHaveBeenCalledWith("cow_1", {
      priority: 5,
      capabilities: ["chat", "tasks"],
    });
    expect(result.priority).toBe(5);
  });

  it("updates whitelist via whitelist endpoint", async () => {
    patchCoworkerWhitelistMock.mockResolvedValue({
      data: { ...coworker, isWhitelisted: true },
    });

    const result = await adminCoworkerService.updateWhitelist("cow_1", true);

    expect(patchCoworkerWhitelistMock).toHaveBeenCalledWith("cow_1", {
      isWhitelisted: true,
    });
    expect(result.isWhitelisted).toBe(true);
  });

  it("archives coworker via delete endpoint", async () => {
    archiveCoworkerMock.mockResolvedValue({
      data: archivedCoworker,
    });

    const result = await adminCoworkerService.archiveCoworker("cow_2");

    expect(archiveCoworkerMock).toHaveBeenCalledWith("cow_2");
    expect(result.archivedAt).not.toBeNull();
  });

  it("unarchives coworker via unarchive endpoint", async () => {
    unarchiveCoworkerMock.mockResolvedValue({
      data: coworker,
    });

    const result = await adminCoworkerService.unarchiveCoworker("cow_2");

    expect(unarchiveCoworkerMock).toHaveBeenCalledWith("cow_2");
    expect(result.archivedAt).toBeNull();
  });

  it("patches text before uploading image", async () => {
    patchCoworkerMock.mockResolvedValue({
      data: { ...coworker, name: "Ops Agent Updated" },
    });
    uploadCoworkerImageMock.mockResolvedValue({
      data: {
        ...coworker,
        name: "Ops Agent Updated",
        image: "https://example.com/new.png",
      },
    });

    const file = new File(["x"], "new.png", { type: "image/png" });
    const result = await adminCoworkerService.updateDisplay({
      id: "cow_1",
      patchBody: { name: "Ops Agent Updated" },
      imageIntent: "upload",
      imageFile: file,
    });

    expect(patchCoworkerMock).toHaveBeenCalledBefore(uploadCoworkerImageMock);
    expect(result.coworker.name).toBe("Ops Agent Updated");
    expect(result.coworker.image).toBe("https://example.com/new.png");
    expect(result.imageError).toBeUndefined();
  });

  it("keeps saved text when image upload fails", async () => {
    patchCoworkerMock.mockResolvedValue({
      data: { ...coworker, name: "Ops Agent Updated" },
    });
    uploadCoworkerImageMock.mockRejectedValue(new Error("blob down"));

    const file = new File(["x"], "new.png", { type: "image/png" });
    const result = await adminCoworkerService.updateDisplay({
      id: "cow_1",
      patchBody: { name: "Ops Agent Updated" },
      imageIntent: "upload",
      imageFile: file,
    });

    expect(result.coworker.name).toBe("Ops Agent Updated");
    expect(result.imageError).toBe("blob down");
  });

  it("uploads image without a text patch", async () => {
    uploadCoworkerImageMock.mockResolvedValue({
      data: {
        ...coworker,
        image: "https://example.com/new.png",
      },
    });

    const file = new File(["x"], "new.png", { type: "image/png" });
    const result = await adminCoworkerService.updateDisplay({
      id: "cow_1",
      imageIntent: "upload",
      imageFile: file,
    });

    expect(patchCoworkerMock).not.toHaveBeenCalled();
    expect(uploadCoworkerImageMock).toHaveBeenCalledWith("cow_1", file);
    expect(result.coworker.image).toBe("https://example.com/new.png");
    expect(result.imageError).toBeUndefined();
  });

  it("removes image without a text patch", async () => {
    deleteCoworkerImageMock.mockResolvedValue({
      data: {
        ...coworker,
        image: null,
      },
    });

    const result = await adminCoworkerService.updateDisplay({
      id: "cow_1",
      imageIntent: "remove",
    });

    expect(patchCoworkerMock).not.toHaveBeenCalled();
    expect(deleteCoworkerImageMock).toHaveBeenCalledWith("cow_1");
    expect(result.coworker.image).toBeNull();
    expect(result.imageError).toBeUndefined();
  });

  it("throws 404 when text-only update finds no coworker", async () => {
    getCoworkerByIdMock.mockRejectedValue(
      new CoreApiRequestError("Not found", { status: 404 }),
    );

    await expect(
      adminCoworkerService.updateDisplay({
        id: "cow_missing",
        imageIntent: "none",
      }),
    ).rejects.toMatchObject({
      name: "CoreApiRequestError",
      status: 404,
    });
  });
});
