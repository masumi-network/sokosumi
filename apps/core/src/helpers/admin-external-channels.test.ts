import { beforeEach, describe, expect, it, vi } from "vitest";

import { listAdminExternalChannels } from "./admin-organization-overview";

const findManyMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  findManyMock.mockResolvedValue([]);
});

describe("listAdminExternalChannels", () => {
  it("returns non-archived external channels for the host org", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Partners",
        slug: "partners",
      },
    ]);

    const tx = { chatRoom: { findMany: findManyMock } };
    await expect(
      listAdminExternalChannels("org_1", tx as never),
    ).resolves.toEqual([
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Partners",
        slug: "partners",
      },
    ]);

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        kind: "channel",
        discoverability: "external",
        archivedAt: null,
      },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });
  });
});
