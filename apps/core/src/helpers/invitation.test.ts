import { beforeEach, describe, expect, it, vi } from "vitest";

const getPendingInvitationByIdMock = vi.fn();
const getPendingInvitationsByOrganizationIdMock = vi.fn();
const getMemberByUserIdAndOrganizationIdMock = vi.fn();

vi.mock("@sokosumi/database/repositories", () => ({
  invitationRepository: {
    getPendingInvitationById: (...args: unknown[]) =>
      getPendingInvitationByIdMock(...args),
    getPendingInvitationsByOrganizationId: (...args: unknown[]) =>
      getPendingInvitationsByOrganizationIdMock(...args),
  },
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import {
  cancelPendingOrganizationInvitationsForUser,
  listPendingInvitationsByOrganizationId,
  listPendingOrganizationInvitationsForUser,
  lookupPendingInvitationById,
} from "./invitation.js";

const baseInvitation = {
  id: "inv_1",
  organizationId: "org_1",
  email: "jane@example.com",
  role: "member",
  status: "pending",
  expiresAt: new Date("2999-01-01T00:00:00.000Z"),
  inviterId: "user_1",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  organization: { id: "org_1", name: "Acme", slug: "acme", extra: "ignored" },
  inviter: { id: "user_1", email: "owner@example.com", name: "ignored" },
};

describe("lookupPendingInvitationById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns not_found when no pending invitation exists", async () => {
    getPendingInvitationByIdMock.mockResolvedValue(null);
    expect(await lookupPendingInvitationById("inv_x")).toEqual({
      kind: "not_found",
    });
    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("returns expired when the invitation has lapsed", async () => {
    getPendingInvitationByIdMock.mockResolvedValue({
      ...baseInvitation,
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
    });
    expect(await lookupPendingInvitationById("inv_1")).toEqual({
      kind: "expired",
    });
    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("returns inviter_not_found when the inviter is no longer a member", async () => {
    getPendingInvitationByIdMock.mockResolvedValue(baseInvitation);
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue(null);
    expect(await lookupPendingInvitationById("inv_1")).toEqual({
      kind: "inviter_not_found",
    });
  });

  it("maps only the exposed fields on the ok path", async () => {
    getPendingInvitationByIdMock.mockResolvedValue(baseInvitation);
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({ id: "mem_1" });

    const result = await lookupPendingInvitationById("inv_1");

    expect(result).toEqual({
      kind: "ok",
      invitation: {
        id: "inv_1",
        organizationId: "org_1",
        email: "jane@example.com",
        role: "member",
        status: "pending",
        expiresAt: baseInvitation.expiresAt,
        inviterId: "user_1",
        createdAt: baseInvitation.createdAt,
        organization: { id: "org_1", name: "Acme", slug: "acme" },
        inviter: { id: "user_1", email: "owner@example.com" },
      },
    });
  });
});

describe("listPendingInvitationsByOrganizationId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the first invitation per email (most recent expiry)", async () => {
    getPendingInvitationsByOrganizationIdMock.mockResolvedValue([
      { id: "a", email: "dup@example.com" },
      { id: "b", email: "dup@example.com" },
      { id: "c", email: "other@example.com" },
    ]);

    const result = await listPendingInvitationsByOrganizationId("org_1");

    expect(result.map((i) => i.id)).toEqual(["a", "c"]);
  });
});

describe("listPendingOrganizationInvitationsForUser", () => {
  const userFindUnique = vi.fn();
  const invitationFindMany = vi.fn();
  const tx = {
    user: { findUnique: userFindUnique },
    invitation: { findMany: invitationFindMany },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty list when the user row is missing", async () => {
    userFindUnique.mockResolvedValue(null);

    await expect(
      listPendingOrganizationInvitationsForUser("user_x", tx),
    ).resolves.toEqual([]);
    expect(invitationFindMany).not.toHaveBeenCalled();
  });

  it("returns non-expired pending invitations for the user's email", async () => {
    userFindUnique.mockResolvedValue({ email: "Ada@Example.com" });
    invitationFindMany.mockResolvedValue([
      {
        id: "inv_1",
        organizationId: "org_1",
        email: "ada@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date("2999-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        organization: {
          id: "org_1",
          name: "Acme",
          slug: "acme",
          logo: "https://example.com/logo.png",
        },
      },
    ]);

    await expect(
      listPendingOrganizationInvitationsForUser("user_1", tx),
    ).resolves.toEqual([
      {
        id: "inv_1",
        organizationId: "org_1",
        email: "ada@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date("2999-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        organization: {
          id: "org_1",
          name: "Acme",
          slug: "acme",
          logo: "https://example.com/logo.png",
        },
      },
    ]);

    expect(invitationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "pending",
          email: { equals: "ada@example.com", mode: "insensitive" },
        }),
      }),
    );
  });

  it("queries only invitations that expire after now", async () => {
    const before = Date.now();
    userFindUnique.mockResolvedValue({ email: "ada@example.com" });
    invitationFindMany.mockResolvedValue([]);

    await listPendingOrganizationInvitationsForUser("user_1", tx);
    const after = Date.now();

    const call = invitationFindMany.mock.calls[0]?.[0] as {
      where: { expiresAt: { gt: Date } };
    };
    const gt = call.where.expiresAt.gt.getTime();
    expect(gt).toBeGreaterThanOrEqual(before);
    expect(gt).toBeLessThanOrEqual(after);
  });

  it("maps only the organization preview fields", async () => {
    userFindUnique.mockResolvedValue({ email: "ada@example.com" });
    invitationFindMany.mockResolvedValue([
      {
        id: "inv_1",
        organizationId: "org_1",
        email: "ada@example.com",
        role: null,
        status: "pending",
        expiresAt: new Date("2999-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        organization: {
          id: "org_1",
          name: "Acme",
          slug: "acme",
          logo: null,
          extra: "ignored",
        },
      },
    ]);

    const result = await listPendingOrganizationInvitationsForUser(
      "user_1",
      tx,
    );

    expect(result[0]?.organization).toEqual({
      id: "org_1",
      name: "Acme",
      slug: "acme",
      logo: null,
    });
  });
});

describe("cancelPendingOrganizationInvitationsForUser", () => {
  const userFindUnique = vi.fn();
  const invitationUpdateMany = vi.fn();
  const tx = {
    user: { findUnique: userFindUnique },
    invitation: { updateMany: invitationUpdateMany },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 and skips the write when the user row is missing", async () => {
    userFindUnique.mockResolvedValue(null);

    await expect(
      cancelPendingOrganizationInvitationsForUser("user_x", "org_1", tx),
    ).resolves.toBe(0);
    expect(invitationUpdateMany).not.toHaveBeenCalled();
  });

  it("cancels pending invitations for that user email and organization", async () => {
    userFindUnique.mockResolvedValue({ email: "Ada@Example.com" });
    invitationUpdateMany.mockResolvedValue({ count: 2 });

    await expect(
      cancelPendingOrganizationInvitationsForUser("user_1", "org_1", tx),
    ).resolves.toBe(2);

    expect(invitationUpdateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        status: "pending",
        email: { equals: "ada@example.com", mode: "insensitive" },
      },
      data: { status: "canceled" },
    });
  });
});
