import { CoworkerWorkspaceAccessStatus, MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertCoworkerWorkspaceAccess } from "./coworker-workspace-access-grant";

const {
  workspaceFindUnique,
  memberFindFirst,
  coworkerFindFirst,
  accessFindUnique,
  accessCreate,
  accessUpsert,
  requireVendorAdmin,
  clearNotifications,
} = vi.hoisted(() => ({
  workspaceFindUnique: vi.fn(),
  memberFindFirst: vi.fn(),
  coworkerFindFirst: vi.fn(),
  accessFindUnique: vi.fn(),
  accessCreate: vi.fn(),
  accessUpsert: vi.fn(),
  requireVendorAdmin: vi.fn(),
  clearNotifications: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: workspaceFindUnique },
    member: { findFirst: memberFindFirst },
    coworker: { findFirst: coworkerFindFirst },
    coworkerWorkspaceAccess: {
      findUnique: accessFindUnique,
      create: accessCreate,
      upsert: accessUpsert,
    },
  },
}));
vi.mock("@/helpers/vendor-membership", () => ({
  requireVendorAdminMembership: requireVendorAdmin,
}));
vi.mock("@/helpers/notifications", () => ({
  deletePendingCoworkerAccessNotifications: clearNotifications,
}));

const input = {
  coworkerId: "coworker-1",
  workspaceId: "workspace-1",
  actorUserId: "actor-1",
  isPlatformAdmin: false,
};
const pending = {
  id: "access-1",
  status: CoworkerWorkspaceAccessStatus.PENDING,
};

describe("Coworker workspace grant authority", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    workspaceFindUnique.mockResolvedValue({
      id: input.workspaceId,
      userId: null,
      organizationId: "org-1",
    });
    coworkerFindFirst.mockResolvedValue({
      id: input.coworkerId,
      vendorId: "vendor-1",
    });
    accessFindUnique.mockResolvedValue(null);
    accessCreate.mockResolvedValue(pending);
    accessUpsert.mockResolvedValue({
      id: "access-1",
      status: CoworkerWorkspaceAccessStatus.GRANTED,
    });
    requireVendorAdmin.mockResolvedValue(undefined);
  });

  it.each([MemberRole.OWNER, MemberRole.ADMIN])(
    "grants immediately for organization %s",
    async (role) => {
      memberFindFirst.mockResolvedValue({ role });
      const result = await upsertCoworkerWorkspaceAccess(input);
      expect(result.access.status).toBe(CoworkerWorkspaceAccessStatus.GRANTED);
      expect(result.pendingNotify).toBeNull();
      expect(accessCreate).not.toHaveBeenCalled();
      expect(requireVendorAdmin).toHaveBeenCalledWith(
        "actor-1",
        "vendor-1",
        expect.anything(),
      );
    },
  );

  it("regular organization member creates PENDING, never GRANTED", async () => {
    memberFindFirst.mockResolvedValue({ role: MemberRole.MEMBER });
    const result = await upsertCoworkerWorkspaceAccess(input);
    expect(result.access.status).toBe(CoworkerWorkspaceAccessStatus.PENDING);
    expect(memberFindFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", userId: "actor-1" },
      select: { role: true },
    });
    expect(result.pendingNotify).toEqual({
      coworkerId: input.coworkerId,
      workspaceId: input.workspaceId,
      accessId: "access-1",
    });
    expect(accessUpsert).not.toHaveBeenCalled();
    expect(accessCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CoworkerWorkspaceAccessStatus.PENDING,
          resolvedAt: null,
          resolvedById: null,
        }),
      }),
    );
  });

  it("regular member retry preserves PENDING without a second notification", async () => {
    memberFindFirst.mockResolvedValue({ role: MemberRole.MEMBER });
    accessFindUnique.mockResolvedValue(pending);
    const result = await upsertCoworkerWorkspaceAccess(input);
    expect(result).toEqual({ access: pending, pendingNotify: null });
    expect(accessCreate).not.toHaveBeenCalled();
    expect(accessUpsert).not.toHaveBeenCalled();
  });

  it.each([
    CoworkerWorkspaceAccessStatus.DENIED,
    CoworkerWorkspaceAccessStatus.REVOKED,
  ])("regular member cannot reopen %s", async (status) => {
    memberFindFirst.mockResolvedValue({ role: MemberRole.MEMBER });
    accessFindUnique.mockResolvedValue({ id: "access-1", status });
    await expect(upsertCoworkerWorkspaceAccess(input)).rejects.toMatchObject({
      status: 400,
      message: "Cannot re-request after deny/revoke",
    });
    expect(accessUpsert).not.toHaveBeenCalled();
    expect(accessCreate).not.toHaveBeenCalled();
  });

  it("personal workspace owner grants without organization membership", async () => {
    workspaceFindUnique.mockResolvedValue({
      id: input.workspaceId,
      userId: input.actorUserId,
      organizationId: null,
    });
    expect((await upsertCoworkerWorkspaceAccess(input)).access.status).toBe(
      CoworkerWorkspaceAccessStatus.GRANTED,
    );
    expect(memberFindFirst).not.toHaveBeenCalled();
  });

  it("foreign personal workspace requires owner approval", async () => {
    workspaceFindUnique.mockResolvedValue({
      id: input.workspaceId,
      userId: "other-user",
      organizationId: null,
    });
    expect((await upsertCoworkerWorkspaceAccess(input)).access.status).toBe(
      CoworkerWorkspaceAccessStatus.PENDING,
    );
    expect(accessUpsert).not.toHaveBeenCalled();
  });
});
