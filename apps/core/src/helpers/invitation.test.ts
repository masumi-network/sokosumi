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
  listPendingInvitationsByOrganizationId,
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
