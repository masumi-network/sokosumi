import type { Prisma } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import { resolveMemberOrganizationByIdOrSlug } from "./organization";

function createTransactionClient() {
  return {
    organization: {
      findUnique: vi.fn(),
    },
    member: {
      findUnique: vi.fn(),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("resolveMemberOrganizationByIdOrSlug", () => {
  it("resolves organization by id", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce({
      id: "org_123",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      name: "My Organization",
      slug: "my-org",
      logo: null,
      metadata: null,
      stripeCustomerId: null,
      invoiceEmail: null,
    });
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce({
      id: "member_1",
      role: "member",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      userId: "user_123",
      organizationId: "org_123",
    });

    const result = await resolveMemberOrganizationByIdOrSlug({
      idOrSlug: "org_123",
      userId: "user_123",
      tx,
    });

    expect(result.organization.id).toBe("org_123");
    expect(result.role).toBe("member");
    expect(tx.organization.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.organization.findUnique).toHaveBeenCalledWith({
      where: { id: "org_123" },
    });
  });

  it("falls back to slug when id lookup fails", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "org_123",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        name: "My Organization",
        slug: "my-org",
        logo: null,
        metadata: null,
        stripeCustomerId: null,
        invoiceEmail: null,
      });
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce({
      id: "member_1",
      role: "member",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      userId: "user_123",
      organizationId: "org_123",
    });

    const result = await resolveMemberOrganizationByIdOrSlug({
      idOrSlug: "my-org",
      userId: "user_123",
      tx,
    });

    expect(result.organization.slug).toBe("my-org");
    expect(tx.organization.findUnique).toHaveBeenNthCalledWith(2, {
      where: { slug: "my-org" },
    });
  });

  it("throws when organization does not exist", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(
      resolveMemberOrganizationByIdOrSlug({
        idOrSlug: "missing-org",
        userId: "user_123",
        tx,
      }),
    ).rejects.toThrow("Organization not found");
  });

  it("throws when user is not a member of the organization", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce({
      id: "org_123",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      name: "My Organization",
      slug: "my-org",
      logo: null,
      metadata: null,
      stripeCustomerId: null,
      invoiceEmail: null,
    });
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(null);

    await expect(
      resolveMemberOrganizationByIdOrSlug({
        idOrSlug: "org_123",
        userId: "user_123",
        tx,
      }),
    ).rejects.toThrow("You are not a member of this organization");
  });
});
