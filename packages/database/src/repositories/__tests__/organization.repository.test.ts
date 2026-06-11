import { beforeEach, describe, expect, it, vi } from "vitest";

import { organizationRepository } from "../organization.repository.js";

const findManyMock = vi.fn();
const findUniqueMock = vi.fn();
const updateMock = vi.fn();

const tx = {
  organization: {
    findMany: findManyMock,
    findUnique: findUniqueMock,
    update: updateMock,
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

describe("organizationRepository.updateOrganizationInvoiceEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockImplementation(
      ({ data }: { data: { metadata: string | null } }) => ({
        id: "org_1",
        metadata: data.metadata,
      }),
    );
  });

  it("preserves unrelated metadata keys when setting the invoice email", async () => {
    findUniqueMock.mockResolvedValue({
      metadata: JSON.stringify({
        designMdUrl: "https://blob.example/design.md",
        designMdExtractionId: "ext_1",
      }),
    });

    await organizationRepository.updateOrganizationInvoiceEmail(
      "org_1",
      "billing@acme.example",
      tx,
    );

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: {
        metadata: JSON.stringify({
          designMdUrl: "https://blob.example/design.md",
          designMdExtractionId: "ext_1",
          invoiceEmail: "billing@acme.example",
        }),
      },
    });
  });

  it("preserves unrelated metadata keys when clearing the invoice email", async () => {
    findUniqueMock.mockResolvedValue({
      metadata: JSON.stringify({
        designMdUrl: "https://blob.example/design.md",
        invoiceEmail: "old@acme.example",
      }),
    });

    await organizationRepository.updateOrganizationInvoiceEmail(
      "org_1",
      null,
      tx,
    );

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: {
        metadata: JSON.stringify({
          designMdUrl: "https://blob.example/design.md",
        }),
      },
    });
  });

  it("collapses metadata to null when clearing the only key", async () => {
    findUniqueMock.mockResolvedValue({
      metadata: JSON.stringify({ invoiceEmail: "old@acme.example" }),
    });

    await organizationRepository.updateOrganizationInvoiceEmail(
      "org_1",
      null,
      tx,
    );

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { metadata: null },
    });
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
