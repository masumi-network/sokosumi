import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getCoworkersMock = vi.fn();
const getCoworkerByIdMock = vi.fn();
const patchCoworkerMock = vi.fn();
const patchCoworkerWhitelistMock = vi.fn();
const archiveCoworkerMock = vi.fn();
const unarchiveCoworkerMock = vi.fn();

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
});
