import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getOwnedCoworkersMock = vi.fn();
const getOwnedCoworkerByIdMock = vi.fn();

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
    getOwnedCoworkers: (...args: unknown[]) => getOwnedCoworkersMock(...args),
    getOwnedCoworkerById: (...args: unknown[]) =>
      getOwnedCoworkerByIdMock(...args),
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";

import { developerCoworkerService } from "./developer-coworker.service";

const activeCoworker = {
  id: "cow_1",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-02T00:00:00.000Z"),
  archivedAt: null,
  userId: "user_owner",
  vendorId: "vendor_1",
  slug: "ops-agent",
  name: "Ops Agent",
  caption: null,
  description: null,
  url: null,
  baseURL: null,
  capabilities: [],
  image: null,
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
  ...activeCoworker,
  id: "cow_2",
  archivedAt: new Date("2025-02-01T00:00:00.000Z"),
};

describe("developerCoworkerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only active owned coworkers", async () => {
    getOwnedCoworkersMock.mockResolvedValue({
      data: [activeCoworker, archivedCoworker],
    });

    const result = await developerCoworkerService.listOwnedCoworkers();

    expect(getOwnedCoworkersMock).toHaveBeenCalled();
    expect(result).toEqual([activeCoworker]);
  });

  it("fetches owned coworker by id", async () => {
    getOwnedCoworkerByIdMock.mockResolvedValue({
      data: activeCoworker,
    });

    const result = await developerCoworkerService.getOwnedCoworkerById("cow_1");

    expect(getOwnedCoworkersMock).not.toHaveBeenCalled();
    expect(getOwnedCoworkerByIdMock).toHaveBeenCalledWith("cow_1");
    expect(result).toEqual(activeCoworker);
  });

  it("returns null when owned coworker is missing", async () => {
    getOwnedCoworkerByIdMock.mockRejectedValue(
      new CoreApiRequestError("Not found", { status: 404 }),
    );

    const result =
      await developerCoworkerService.getOwnedCoworkerById("cow_other");

    expect(getOwnedCoworkersMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("rethrows non-404 owned coworker reads", async () => {
    getOwnedCoworkerByIdMock.mockRejectedValue(
      new CoreApiRequestError("Forbidden", { status: 403 }),
    );

    await expect(
      developerCoworkerService.getOwnedCoworkerById("cow_1"),
    ).rejects.toMatchObject({
      name: "CoreApiRequestError",
      status: 403,
    });
  });
});
