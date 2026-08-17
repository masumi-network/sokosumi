import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getOwnedCoworkersMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getOwnedCoworkers: (...args: unknown[]) => getOwnedCoworkersMock(...args),
  },
}));

import { developerCoworkerService } from "../developer-coworker.service";

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

  it("returns owned coworker by id from owned list", async () => {
    getOwnedCoworkersMock.mockResolvedValue({
      data: [activeCoworker, archivedCoworker],
    });

    const result = await developerCoworkerService.getOwnedCoworkerById("cow_1");

    expect(result).toEqual(activeCoworker);
  });

  it("returns null when coworker is not in owned list", async () => {
    getOwnedCoworkersMock.mockResolvedValue({
      data: [activeCoworker],
    });

    const result =
      await developerCoworkerService.getOwnedCoworkerById("cow_other");

    expect(result).toBeNull();
  });
});
