import { MemberRole, type Prisma } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import {
  resolveMemberOrganizationById,
  resolveMemberOrganizationBySlug,
} from "./organization";

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

function createOrganization(overrides: Record<string, unknown> = {}) {
  return {
    id: "org_123",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    name: "My Organization",
    slug: "my-org",
    logo: null,
    metadata: null,
    stripeCustomerId: null,
    ...overrides,
  };
}

function createMember(overrides: Record<string, unknown> = {}) {
  return {
    id: "member_1",
    role: MemberRole.MEMBER,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    seatAssignedAt: null,
    userId: "user_123",
    organizationId: "org_123",
    ...overrides,
  };
}

describe("resolveMemberOrganizationById", () => {
  it("resolves organization by id", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce(
      createOrganization(),
    );
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(createMember());

    const result = await resolveMemberOrganizationById({
      id: "org_123",
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

  it("throws when the identifier only matches a slug", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce(null);

    await expect(
      resolveMemberOrganizationById({
        id: "my-org",
        userId: "user_123",
        tx,
      }),
    ).rejects.toThrow("Organization not found");
    expect(tx.member.findUnique).not.toHaveBeenCalled();
  });

  it("throws when organization does not exist", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce(null);

    await expect(
      resolveMemberOrganizationById({
        id: "missing-org",
        userId: "user_123",
        tx,
      }),
    ).rejects.toThrow("Organization not found");
  });

  it("throws when user is not a member of the organization", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce(
      createOrganization(),
    );
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(null);

    await expect(
      resolveMemberOrganizationById({
        id: "org_123",
        userId: "user_123",
        tx,
      }),
    ).rejects.toThrow("You are not a member of this organization");
  });

  it("allows owner when owner or admin role is required", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce(
      createOrganization(),
    );
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(
      createMember({
        role: MemberRole.OWNER,
      }),
    );

    const result = await resolveMemberOrganizationById({
      id: "org_123",
      userId: "user_123",
      tx,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    expect(result.role).toBe(MemberRole.OWNER);
  });

  it("allows admin when owner or admin role is required", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce(
      createOrganization(),
    );
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(
      createMember({
        role: MemberRole.ADMIN,
      }),
    );

    const result = await resolveMemberOrganizationById({
      id: "org_123",
      userId: "user_123",
      tx,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    expect(result.role).toBe(MemberRole.ADMIN);
  });

  it("throws when member role is not allowed", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce(
      createOrganization(),
    );
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(createMember());

    await expect(
      resolveMemberOrganizationById({
        id: "org_123",
        userId: "user_123",
        tx,
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    ).rejects.toThrow("You must be owner, admin");
  });
});

describe("resolveMemberOrganizationBySlug", () => {
  it("resolves organization by slug", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce(
      createOrganization(),
    );
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(createMember());

    const result = await resolveMemberOrganizationBySlug({
      slug: "my-org",
      userId: "user_123",
      tx,
    });

    expect(result.organization.id).toBe("org_123");
    expect(result.role).toBe("member");
    expect(tx.organization.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.organization.findUnique).toHaveBeenCalledWith({
      where: { slug: "my-org" },
    });
  });

  it("throws when no organization matches the slug", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce(null);

    await expect(
      resolveMemberOrganizationBySlug({
        slug: "missing-org",
        userId: "user_123",
        tx,
      }),
    ).rejects.toThrow("Organization not found");
    expect(tx.member.findUnique).not.toHaveBeenCalled();
  });

  it("throws when user is not a member of the organization", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce(
      createOrganization(),
    );
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(null);

    await expect(
      resolveMemberOrganizationBySlug({
        slug: "my-org",
        userId: "user_123",
        tx,
      }),
    ).rejects.toThrow("You are not a member of this organization");
  });

  it("throws when member role is not allowed", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.organization.findUnique).mockResolvedValueOnce(
      createOrganization(),
    );
    vi.mocked(tx.member.findUnique).mockResolvedValueOnce(createMember());

    await expect(
      resolveMemberOrganizationBySlug({
        slug: "my-org",
        userId: "user_123",
        tx,
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    ).rejects.toThrow("You must be owner, admin");
  });
});
