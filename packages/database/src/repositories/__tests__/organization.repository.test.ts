import { beforeEach, describe, expect, it, vi } from "vitest";

import { organizationRepository } from "../organization.repository.js";

const findManyMock = vi.fn();
const findUniqueMock = vi.fn();
const tx = {
  organization: {
    findMany: findManyMock,
    findUnique: findUniqueMock,
  },
} as never;

describe("organizationRepository.searchOrganizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([
      { id: "org_1", name: "Acme", slug: "acme" },
    ]);
  });

  it("matches name or slug case-insensitively, ordered and limited", async () => {
    const result = await organizationRepository.searchOrganizations(
      "acm",
      20,
      tx,
    );

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { name: { contains: "acm", mode: "insensitive" } },
          { slug: { contains: "acm", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
      take: 20,
    });
    expect(result).toEqual([{ id: "org_1", name: "Acme", slug: "acme" }]);
  });

  it("short-circuits to an empty array for blank queries without querying", async () => {
    await expect(
      organizationRepository.searchOrganizations("", 20, tx),
    ).resolves.toEqual([]);
    await expect(
      organizationRepository.searchOrganizations("   ", 20, tx),
    ).resolves.toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe("organizationRepository.getOrganizationLimitedInfoBySlug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme",
    });
  });

  it("looks up a single organization by slug with limited fields", async () => {
    const result =
      await organizationRepository.getOrganizationLimitedInfoBySlug("acme", tx);

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { slug: "acme" },
      select: { id: true, name: true, slug: true },
    });
    expect(result).toEqual({ id: "org_1", name: "Acme", slug: "acme" });
  });
});
