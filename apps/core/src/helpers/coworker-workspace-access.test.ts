import { CoworkerWorkspaceAccessStatus, MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";

import {
  approveCoworkerWorkspaceAccess,
  type CoworkerWorkspaceAccessWithCoworker,
  denyCoworkerWorkspaceAccess,
  forceRevokeCoworkerWorkspaceAccessByPair,
  isCoworkerAccessTerminal,
  listCoworkerAccessForWorkspace,
  notifyWorkspaceApproversOfPendingCoworkerAccess,
  resolveCoworkerAccessTargetWorkspaceId,
  revokeCoworkerWorkspaceAccess,
  toCoworkerWorkspaceAccessApiShape,
  upsertCoworkerWorkspaceAccess,
  userBelongsToWorkspace,
} from "./coworker-workspace-access";

const accessFindUnique = vi.fn();
const accessFindFirst = vi.fn();
const accessFindMany = vi.fn();
const accessCreate = vi.fn();
const accessUpsert = vi.fn();
const accessUpdate = vi.fn();
const coworkerFindFirst = vi.fn();
const coworkerFindUnique = vi.fn();
const memberFindFirst = vi.fn();
const memberFindMany = vi.fn();
const workspaceFindUnique = vi.fn();
const userFindUnique = vi.fn();
const userFindFirst = vi.fn();
const organizationFindUnique = vi.fn();
const organizationFindFirst = vi.fn();
const chatRoomCoworkerMemberDeleteMany = vi.fn();
const chatRoomCoworkerMemberFindMany = vi.fn();
const chatRoomMentionUpdateMany = vi.fn();
const recordChannelMembershipStatusMock = vi.fn();
const resolveWorkspaceForContextMock = vi.fn();
const createNotificationMock = vi.fn();
const deletePendingCoworkerAccessNotificationsMock = vi.fn();
const requireVendorAdminMembershipMock = vi.fn();
const queryRawMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworkerWorkspaceAccess: {
      findUnique: (...args: unknown[]) => accessFindUnique(...args),
      findFirst: (...args: unknown[]) => accessFindFirst(...args),
      findMany: (...args: unknown[]) => accessFindMany(...args),
      create: (...args: unknown[]) => accessCreate(...args),
      upsert: (...args: unknown[]) => accessUpsert(...args),
      update: (...args: unknown[]) => accessUpdate(...args),
    },
    coworker: {
      findFirst: (...args: unknown[]) => coworkerFindFirst(...args),
      findUnique: (...args: unknown[]) => coworkerFindUnique(...args),
    },
    member: {
      findFirst: (...args: unknown[]) => memberFindFirst(...args),
      findMany: (...args: unknown[]) => memberFindMany(...args),
    },
    workspace: {
      findUnique: (...args: unknown[]) => workspaceFindUnique(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      findFirst: (...args: unknown[]) => userFindFirst(...args),
    },
    organization: {
      findUnique: (...args: unknown[]) => organizationFindUnique(...args),
      findFirst: (...args: unknown[]) => organizationFindFirst(...args),
    },
    chatRoomCoworkerMember: {
      findMany: (...args: unknown[]) => chatRoomCoworkerMemberFindMany(...args),
      deleteMany: (...args: unknown[]) =>
        chatRoomCoworkerMemberDeleteMany(...args),
    },
    chatRoomMention: {
      updateMany: (...args: unknown[]) => chatRoomMentionUpdateMany(...args),
    },
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  },
}));

vi.mock("@/routes/v1/chats/rooms/membership-status", () => ({
  recordChannelMembershipStatus: (...args: unknown[]) =>
    recordChannelMembershipStatusMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  workspaceRepository: {
    resolveWorkspaceForContext: (...args: unknown[]) =>
      resolveWorkspaceForContextMock(...args),
  },
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
  deletePendingCoworkerAccessNotifications: (...args: unknown[]) =>
    deletePendingCoworkerAccessNotificationsMock(...args),
}));

vi.mock("@/helpers/vendor-membership", () => ({
  requireVendorAdminMembership: (...args: unknown[]) =>
    requireVendorAdminMembershipMock(...args),
}));

const now = new Date("2026-08-05T12:00:00.000Z");

function baseAccess(
  overrides: Partial<{
    id: string;
    coworkerId: string;
    workspaceId: string;
    status: CoworkerWorkspaceAccessStatus;
    requestedByUserId: string | null;
    resolvedAt: Date | null;
    resolvedById: string | null;
    createdAt: Date;
    updatedAt: Date;
    coworker: { name: string; slug: string };
    workspace: CoworkerWorkspaceAccessWithCoworker["workspace"];
  }> = {},
) {
  return {
    id: "access-1",
    coworkerId: "coworker-1",
    workspaceId: "workspace-1",
    status: CoworkerWorkspaceAccessStatus.PENDING,
    requestedByUserId: "actor-1",
    resolvedAt: null,
    resolvedById: null,
    createdAt: now,
    updatedAt: now,
    coworker: { name: "Ops Pilot", slug: "ops-pilot" },
    workspace: {
      id: "workspace-1",
      userId: null,
      organizationId: "org-1",
      user: null,
      organization: { name: "Acme Corp", slug: "acme-corp" },
    },
    ...overrides,
  };
}

describe("coworker-workspace-access helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryRawMock.mockResolvedValue(undefined);
    requireVendorAdminMembershipMock.mockResolvedValue(undefined);
    createNotificationMock.mockResolvedValue({ created: true });
    deletePendingCoworkerAccessNotificationsMock.mockResolvedValue(0);
    chatRoomCoworkerMemberDeleteMany.mockResolvedValue({ count: 0 });
    chatRoomCoworkerMemberFindMany.mockResolvedValue([]);
    chatRoomMentionUpdateMany.mockResolvedValue({ count: 0 });
    recordChannelMembershipStatusMock.mockResolvedValue([]);
    // Default: pilot-only coworker is no longer usable after revoke.
    coworkerFindFirst.mockResolvedValue(null);
  });

  describe("isCoworkerAccessTerminal", () => {
    it("treats DENIED and REVOKED as terminal", () => {
      expect(
        isCoworkerAccessTerminal(CoworkerWorkspaceAccessStatus.DENIED),
      ).toBe(true);
      expect(
        isCoworkerAccessTerminal(CoworkerWorkspaceAccessStatus.REVOKED),
      ).toBe(true);
      expect(
        isCoworkerAccessTerminal(CoworkerWorkspaceAccessStatus.PENDING),
      ).toBe(false);
      expect(
        isCoworkerAccessTerminal(CoworkerWorkspaceAccessStatus.GRANTED),
      ).toBe(false);
    });
  });

  describe("resolveCoworkerAccessTargetWorkspaceId", () => {
    it("returns existing workspace id", async () => {
      workspaceFindUnique.mockResolvedValue({ id: "workspace-1" });

      await expect(
        resolveCoworkerAccessTargetWorkspaceId({
          workspaceId: "workspace-1",
        }),
      ).resolves.toBe("workspace-1");
    });

    it("resolves personal workspace for userId without creating one", async () => {
      userFindUnique.mockResolvedValue({ id: "user-1" });
      workspaceFindUnique.mockResolvedValue({ id: "ws-personal" });

      await expect(
        resolveCoworkerAccessTargetWorkspaceId({ userId: "user-1" }),
      ).resolves.toBe("ws-personal");
      expect(resolveWorkspaceForContextMock).not.toHaveBeenCalled();
    });

    it("404 when personal workspace is missing for userId", async () => {
      userFindUnique.mockResolvedValue({ id: "user-1" });
      workspaceFindUnique.mockResolvedValue(null);

      await expect(
        resolveCoworkerAccessTargetWorkspaceId({ userId: "user-1" }),
      ).rejects.toMatchObject({
        status: 404,
        cause: { kind: "personal_workspace_missing" },
      });
      expect(resolveWorkspaceForContextMock).not.toHaveBeenCalled();
    });

    it("upserts organization workspace for organizationId", async () => {
      organizationFindUnique.mockResolvedValue({ id: "org-1" });
      resolveWorkspaceForContextMock.mockResolvedValue({ id: "ws-org" });

      await expect(
        resolveCoworkerAccessTargetWorkspaceId({ organizationId: "org-1" }),
      ).resolves.toBe("ws-org");
      expect(resolveWorkspaceForContextMock).toHaveBeenCalledWith(
        "org-1",
        "org-1",
        expect.anything(),
      );
    });

    it("404 when user missing", async () => {
      userFindUnique.mockResolvedValue(null);

      await expect(
        resolveCoworkerAccessTargetWorkspaceId({ userId: "missing" }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("resolves personal workspace by email", async () => {
      userFindFirst.mockResolvedValue({ id: "user-1" });
      workspaceFindUnique.mockResolvedValue({ id: "ws-personal" });

      await expect(
        resolveCoworkerAccessTargetWorkspaceId({
          email: "Pilot@Example.com",
        }),
      ).resolves.toBe("ws-personal");
      expect(userFindFirst).toHaveBeenCalledWith({
        where: {
          email: {
            equals: "Pilot@Example.com",
            mode: "insensitive",
          },
        },
        select: { id: true },
      });
    });

    it("resolves organization workspace by slug", async () => {
      organizationFindFirst.mockResolvedValue({ id: "org-1" });
      resolveWorkspaceForContextMock.mockResolvedValue({ id: "ws-org" });

      await expect(
        resolveCoworkerAccessTargetWorkspaceId({
          organizationSlug: "Acme-Corp",
        }),
      ).resolves.toBe("ws-org");
      expect(organizationFindFirst).toHaveBeenCalledWith({
        where: {
          slug: {
            equals: "Acme-Corp",
            mode: "insensitive",
          },
        },
        select: { id: true },
      });
    });

    it("find-only does not create personal workspace on revoke path", async () => {
      userFindUnique.mockResolvedValue({ id: "user-1" });
      workspaceFindUnique.mockResolvedValue(null);

      await expect(
        resolveCoworkerAccessTargetWorkspaceId(
          { userId: "user-1" },
          { createIfMissing: false },
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(resolveWorkspaceForContextMock).not.toHaveBeenCalled();
    });

    it("find-only returns existing personal workspace", async () => {
      userFindUnique.mockResolvedValue({ id: "user-1" });
      workspaceFindUnique.mockResolvedValue({ id: "ws-existing" });

      await expect(
        resolveCoworkerAccessTargetWorkspaceId(
          { userId: "user-1" },
          { createIfMissing: false },
        ),
      ).resolves.toBe("ws-existing");
      expect(resolveWorkspaceForContextMock).not.toHaveBeenCalled();
      expect(workspaceFindUnique).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        select: { id: true },
      });
    });
  });

  describe("toCoworkerWorkspaceAccessApiShape", () => {
    it("maps row fields to DTO", () => {
      const row = baseAccess({
        status: CoworkerWorkspaceAccessStatus.GRANTED,
        resolvedAt: now,
        resolvedById: "admin-1",
      });
      expect(toCoworkerWorkspaceAccessApiShape(row)).toEqual({
        id: row.id,
        coworkerId: row.coworkerId,
        coworkerName: "Ops Pilot",
        coworkerSlug: "ops-pilot",
        workspaceId: row.workspaceId,
        workspaceKind: "organization",
        workspaceDisplayName: "Acme Corp",
        workspaceDisplayDetail: "acme-corp",
        status: CoworkerWorkspaceAccessStatus.GRANTED,
        requestedByUserId: row.requestedByUserId,
        resolvedAt: now.toISOString(),
        resolvedById: "admin-1",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    });

    it("redacts personal workspace email when revealPersonalEmail is false", () => {
      const row = baseAccess({
        status: CoworkerWorkspaceAccessStatus.GRANTED,
      });
      row.workspace = {
        id: "ws-personal",
        userId: "user-owner-1",
        organizationId: null,
        user: { name: "Pilot Owner", email: "pilot@example.com" },
        organization: null,
      };

      expect(
        toCoworkerWorkspaceAccessApiShape(row, { revealPersonalEmail: false }),
      ).toMatchObject({
        workspaceKind: "user",
        workspaceDisplayName: "Pilot Owner",
        workspaceDisplayDetail: "user-owner-1",
      });

      expect(toCoworkerWorkspaceAccessApiShape(row)).toMatchObject({
        workspaceDisplayDetail: "pilot@example.com",
      });
    });
  });

  describe("userBelongsToWorkspace", () => {
    it("returns true for personal workspace owner", async () => {
      workspaceFindUnique.mockResolvedValue({
        userId: "user-1",
        organizationId: null,
      });

      await expect(
        userBelongsToWorkspace("user-1", "workspace-1"),
      ).resolves.toBe(true);
      expect(memberFindFirst).not.toHaveBeenCalled();
    });

    it("returns false for non-owner of personal workspace", async () => {
      workspaceFindUnique.mockResolvedValue({
        userId: "user-1",
        organizationId: null,
      });

      await expect(
        userBelongsToWorkspace("user-2", "workspace-1"),
      ).resolves.toBe(false);
    });

    it("returns true when user is org member of workspace org", async () => {
      workspaceFindUnique.mockResolvedValue({
        userId: null,
        organizationId: "org-1",
      });
      memberFindFirst.mockResolvedValue({ id: "m1" });

      await expect(
        userBelongsToWorkspace("user-1", "workspace-1"),
      ).resolves.toBe(true);
      expect(memberFindFirst).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          userId: "user-1",
        },
        select: { id: true },
      });
    });

    it("returns false when workspace missing", async () => {
      workspaceFindUnique.mockResolvedValue(null);
      await expect(
        userBelongsToWorkspace("user-1", "workspace-1"),
      ).resolves.toBe(false);
    });
  });

  describe("upsertCoworkerWorkspaceAccess", () => {
    it("throws notFound when workspace missing", async () => {
      workspaceFindUnique.mockResolvedValue(null);

      await expect(
        upsertCoworkerWorkspaceAccess({
          coworkerId: "coworker-1",
          workspaceId: "workspace-1",
          actorUserId: "actor-1",
          isPlatformAdmin: true,
        }),
      ).rejects.toMatchObject({
        status: 404,
        message: "Workspace not found",
      });
    });

    it("throws notFound when coworker missing or archived", async () => {
      workspaceFindUnique.mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        organizationId: null,
      });
      coworkerFindFirst.mockResolvedValue(null);

      await expect(
        upsertCoworkerWorkspaceAccess({
          coworkerId: "coworker-1",
          workspaceId: "workspace-1",
          actorUserId: "actor-1",
          isPlatformAdmin: false,
        }),
      ).rejects.toMatchObject({
        status: 404,
        message: "Coworker not found",
      });
      expect(coworkerFindFirst).toHaveBeenCalledWith({
        where: { id: "coworker-1", archivedAt: null },
        select: { id: true, vendorId: true },
      });
    });

    it("platform admin always grants including reopen DENIED", async () => {
      workspaceFindUnique.mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        organizationId: null,
      });
      coworkerFindFirst.mockResolvedValue({
        id: "coworker-1",
        vendorId: "vendor-1",
      });
      accessFindUnique.mockResolvedValue(
        baseAccess({ status: CoworkerWorkspaceAccessStatus.DENIED }),
      );
      const granted = baseAccess({
        status: CoworkerWorkspaceAccessStatus.GRANTED,
        resolvedById: "platform-1",
        resolvedAt: now,
        requestedByUserId: "platform-1",
      });
      accessUpsert.mockResolvedValue(granted);

      const result = await upsertCoworkerWorkspaceAccess({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        actorUserId: "platform-1",
        isPlatformAdmin: true,
      });

      expect(result.access.status).toBe(CoworkerWorkspaceAccessStatus.GRANTED);
      expect(requireVendorAdminMembershipMock).not.toHaveBeenCalled();
      expect(accessUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            coworkerId_workspaceId: {
              coworkerId: "coworker-1",
              workspaceId: "workspace-1",
            },
          },
          create: expect.objectContaining({
            status: CoworkerWorkspaceAccessStatus.GRANTED,
            requestedByUserId: "platform-1",
            resolvedById: "platform-1",
          }),
          update: expect.objectContaining({
            status: CoworkerWorkspaceAccessStatus.GRANTED,
            requestedByUserId: "platform-1",
            resolvedById: "platform-1",
          }),
          include: {
            coworker: {
              select: { name: true, slug: true },
            },
            workspace: {
              select: {
                id: true,
                userId: true,
                organizationId: true,
                user: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
                organization: {
                  select: {
                    name: true,
                    slug: true,
                  },
                },
              },
            },
          },
        }),
      );
    });

    it("platform admin returns existing GRANTED as-is", async () => {
      workspaceFindUnique.mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        organizationId: null,
      });
      coworkerFindFirst.mockResolvedValue({
        id: "coworker-1",
        vendorId: "vendor-1",
      });
      const existing = baseAccess({
        status: CoworkerWorkspaceAccessStatus.GRANTED,
        resolvedById: "other",
      });
      accessFindUnique.mockResolvedValue(existing);

      const result = await upsertCoworkerWorkspaceAccess({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        actorUserId: "platform-1",
        isPlatformAdmin: true,
      });

      expect(result.access).toBe(existing);
      expect(result.pendingNotify).toBeNull();
      expect(accessUpsert).not.toHaveBeenCalled();
    });

    it("platform admin upgrades PENDING to GRANTED", async () => {
      workspaceFindUnique.mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        organizationId: null,
      });
      coworkerFindFirst.mockResolvedValue({
        id: "coworker-1",
        vendorId: "vendor-1",
      });
      accessFindUnique.mockResolvedValue(
        baseAccess({ status: CoworkerWorkspaceAccessStatus.PENDING }),
      );
      const granted = baseAccess({
        status: CoworkerWorkspaceAccessStatus.GRANTED,
      });
      accessUpsert.mockResolvedValue(granted);

      await upsertCoworkerWorkspaceAccess({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        actorUserId: "platform-1",
        isPlatformAdmin: true,
      });

      expect(accessUpsert).toHaveBeenCalled();
    });

    it("vendor admin on member workspace grants immediately", async () => {
      workspaceFindUnique
        .mockResolvedValueOnce({
          id: "workspace-1",
          userId: "actor-1",
          organizationId: null,
        })
        .mockResolvedValueOnce({
          userId: "actor-1",
          organizationId: null,
        });
      coworkerFindFirst.mockResolvedValue({
        id: "coworker-1",
        vendorId: "vendor-1",
      });
      accessFindUnique.mockResolvedValue(null);
      const granted = baseAccess({
        status: CoworkerWorkspaceAccessStatus.GRANTED,
        requestedByUserId: "actor-1",
        resolvedById: "actor-1",
        resolvedAt: now,
      });
      accessUpsert.mockResolvedValue(granted);

      const result = await upsertCoworkerWorkspaceAccess({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        actorUserId: "actor-1",
        isPlatformAdmin: false,
      });

      expect(result.access.status).toBe(CoworkerWorkspaceAccessStatus.GRANTED);
      expect(requireVendorAdminMembershipMock).toHaveBeenCalledWith(
        "actor-1",
        "vendor-1",
        expect.anything(),
      );
      expect(accessUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: CoworkerWorkspaceAccessStatus.GRANTED,
          }),
        }),
      );
      expect(accessCreate).not.toHaveBeenCalled();
    });

    it("vendor admin on member workspace reopens DENIED to GRANTED", async () => {
      workspaceFindUnique
        .mockResolvedValueOnce({
          id: "workspace-1",
          userId: "actor-1",
          organizationId: null,
        })
        .mockResolvedValueOnce({
          userId: "actor-1",
          organizationId: null,
        });
      coworkerFindFirst.mockResolvedValue({
        id: "coworker-1",
        vendorId: "vendor-1",
      });
      accessFindUnique.mockResolvedValue(
        baseAccess({ status: CoworkerWorkspaceAccessStatus.DENIED }),
      );
      const granted = baseAccess({
        status: CoworkerWorkspaceAccessStatus.GRANTED,
        requestedByUserId: "actor-1",
        resolvedById: "actor-1",
        resolvedAt: now,
      });
      accessUpsert.mockResolvedValue(granted);

      const result = await upsertCoworkerWorkspaceAccess({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        actorUserId: "actor-1",
        isPlatformAdmin: false,
      });

      expect(result.access.status).toBe(CoworkerWorkspaceAccessStatus.GRANTED);
      expect(accessUpsert).toHaveBeenCalled();
      expect(accessCreate).not.toHaveBeenCalled();
    });

    it("vendor admin on foreign workspace creates PENDING and notifies", async () => {
      workspaceFindUnique
        .mockResolvedValueOnce({
          id: "workspace-1",
          userId: "owner-1",
          organizationId: null,
        })
        .mockResolvedValueOnce({
          userId: "owner-1",
          organizationId: null,
        })
        .mockResolvedValueOnce({
          userId: "owner-1",
          organizationId: null,
        });
      coworkerFindFirst.mockResolvedValue({
        id: "coworker-1",
        vendorId: "vendor-1",
      });
      accessFindUnique.mockResolvedValue(null);
      const pending = baseAccess({
        status: CoworkerWorkspaceAccessStatus.PENDING,
        requestedByUserId: "actor-1",
      });
      accessCreate.mockResolvedValue(pending);

      const result = await upsertCoworkerWorkspaceAccess({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        actorUserId: "actor-1",
        isPlatformAdmin: false,
      });

      expect(result.access.status).toBe(CoworkerWorkspaceAccessStatus.PENDING);
      expect(accessCreate).toHaveBeenCalledWith({
        data: {
          coworkerId: "coworker-1",
          workspaceId: "workspace-1",
          status: CoworkerWorkspaceAccessStatus.PENDING,
          requestedByUserId: "actor-1",
          resolvedAt: null,
          resolvedById: null,
        },
        include: {
          coworker: {
            select: { name: true, slug: true },
          },
          workspace: {
            select: {
              id: true,
              userId: true,
              organizationId: true,
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
              organization: {
                select: {
                  name: true,
                  slug: true,
                },
              },
            },
          },
        },
      });
      expect(result.pendingNotify).toEqual({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        accessId: pending.id,
      });
      // Route notifies after commit — helper must not write notifications on tx.
      expect(createNotificationMock).not.toHaveBeenCalled();
    });

    it("returns raced row on concurrent foreign PENDING create unique violation", async () => {
      workspaceFindUnique
        .mockResolvedValueOnce({
          id: "workspace-1",
          userId: "owner-1",
          organizationId: null,
        })
        .mockResolvedValueOnce({
          userId: "owner-1",
          organizationId: null,
        });
      coworkerFindFirst.mockResolvedValue({
        id: "coworker-1",
        vendorId: "vendor-1",
      });
      accessFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(
        baseAccess({
          id: "raced-access",
          status: CoworkerWorkspaceAccessStatus.PENDING,
        }),
      );
      accessCreate.mockRejectedValue(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );

      const result = await upsertCoworkerWorkspaceAccess({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        actorUserId: "actor-1",
        isPlatformAdmin: false,
      });

      expect(result.access).toMatchObject({
        id: "raced-access",
        status: CoworkerWorkspaceAccessStatus.PENDING,
      });
      expect(result.pendingNotify).toBeNull();
      expect(createNotificationMock).not.toHaveBeenCalled();
    });

    it("forbids non vendor-admin", async () => {
      workspaceFindUnique.mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        organizationId: null,
      });
      coworkerFindFirst.mockResolvedValue({
        id: "coworker-1",
        vendorId: "vendor-1",
      });
      requireVendorAdminMembershipMock.mockRejectedValue(
        forbidden("Vendor admin access required"),
      );

      await expect(
        upsertCoworkerWorkspaceAccess({
          coworkerId: "coworker-1",
          workspaceId: "workspace-1",
          actorUserId: "actor-1",
          isPlatformAdmin: false,
        }),
      ).rejects.toMatchObject({
        status: 403,
        message: "Vendor admin access required",
      });
      expect(accessCreate).not.toHaveBeenCalled();
      expect(accessUpsert).not.toHaveBeenCalled();
    });

    it("rejects vendor re-request after DENIED", async () => {
      workspaceFindUnique
        .mockResolvedValueOnce({
          id: "workspace-1",
          userId: "owner-1",
          organizationId: null,
        })
        .mockResolvedValueOnce({
          userId: "owner-1",
          organizationId: null,
        });
      coworkerFindFirst.mockResolvedValue({
        id: "coworker-1",
        vendorId: "vendor-1",
      });
      accessFindUnique.mockResolvedValue(
        baseAccess({ status: CoworkerWorkspaceAccessStatus.DENIED }),
      );

      await expect(
        upsertCoworkerWorkspaceAccess({
          coworkerId: "coworker-1",
          workspaceId: "workspace-1",
          actorUserId: "actor-1",
          isPlatformAdmin: false,
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/deny|revoke|re-request/i),
      });
    });

    it("returns existing PENDING as-is for vendor foreign upsert", async () => {
      workspaceFindUnique
        .mockResolvedValueOnce({
          id: "workspace-1",
          userId: "owner-1",
          organizationId: null,
        })
        .mockResolvedValueOnce({
          userId: "owner-1",
          organizationId: null,
        });
      coworkerFindFirst.mockResolvedValue({
        id: "coworker-1",
        vendorId: "vendor-1",
      });
      const existing = baseAccess({
        status: CoworkerWorkspaceAccessStatus.PENDING,
      });
      accessFindUnique.mockResolvedValue(existing);

      const result = await upsertCoworkerWorkspaceAccess({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        actorUserId: "actor-1",
        isPlatformAdmin: false,
      });

      expect(result.access).toBe(existing);
      expect(result.pendingNotify).toBeNull();
      expect(accessCreate).not.toHaveBeenCalled();
      expect(createNotificationMock).not.toHaveBeenCalled();
    });
  });

  describe("approve / deny / revoke", () => {
    it("approves PENDING to GRANTED", async () => {
      accessFindFirst.mockResolvedValue(
        baseAccess({ status: CoworkerWorkspaceAccessStatus.PENDING }),
      );
      const updated = baseAccess({
        status: CoworkerWorkspaceAccessStatus.GRANTED,
        resolvedById: "owner-1",
        resolvedAt: now,
      });
      accessUpdate.mockResolvedValue(updated);

      const result = await approveCoworkerWorkspaceAccess({
        accessId: "access-1",
        workspaceId: "workspace-1",
        resolvedById: "owner-1",
      });

      expect(result.status).toBe(CoworkerWorkspaceAccessStatus.GRANTED);
      expect(accessUpdate).toHaveBeenCalledWith({
        where: { id: "access-1" },
        data: {
          status: CoworkerWorkspaceAccessStatus.GRANTED,
          resolvedAt: expect.any(Date),
          resolvedById: "owner-1",
        },
        include: {
          coworker: {
            select: { name: true, slug: true },
          },
          workspace: {
            select: {
              id: true,
              userId: true,
              organizationId: true,
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
              organization: {
                select: {
                  name: true,
                  slug: true,
                },
              },
            },
          },
        },
      });
      expect(deletePendingCoworkerAccessNotificationsMock).toHaveBeenCalledWith(
        "access-1",
        expect.anything(),
      );
    });

    it("rejects approve when not PENDING", async () => {
      accessFindFirst.mockResolvedValue(
        baseAccess({ status: CoworkerWorkspaceAccessStatus.GRANTED }),
      );

      await expect(
        approveCoworkerWorkspaceAccess({
          accessId: "access-1",
          workspaceId: "workspace-1",
          resolvedById: "owner-1",
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("denies PENDING to DENIED", async () => {
      accessFindFirst.mockResolvedValue(
        baseAccess({ status: CoworkerWorkspaceAccessStatus.PENDING }),
      );
      accessUpdate.mockResolvedValue(
        baseAccess({
          status: CoworkerWorkspaceAccessStatus.DENIED,
          resolvedById: "owner-1",
        }),
      );

      const result = await denyCoworkerWorkspaceAccess({
        accessId: "access-1",
        workspaceId: "workspace-1",
        resolvedById: "owner-1",
      });

      expect(result.status).toBe(CoworkerWorkspaceAccessStatus.DENIED);
      expect(deletePendingCoworkerAccessNotificationsMock).toHaveBeenCalledWith(
        "access-1",
        expect.anything(),
      );
      expect(accessUpdate).toHaveBeenCalledWith({
        where: { id: "access-1" },
        data: {
          status: CoworkerWorkspaceAccessStatus.DENIED,
          resolvedAt: expect.any(Date),
          resolvedById: "owner-1",
        },
        include: {
          coworker: {
            select: { name: true, slug: true },
          },
          workspace: {
            select: {
              id: true,
              userId: true,
              organizationId: true,
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
              organization: {
                select: {
                  name: true,
                  slug: true,
                },
              },
            },
          },
        },
      });
    });

    it("rejects deny when not PENDING", async () => {
      accessFindFirst.mockResolvedValue(
        baseAccess({ status: CoworkerWorkspaceAccessStatus.REVOKED }),
      );

      await expect(
        denyCoworkerWorkspaceAccess({
          accessId: "access-1",
          workspaceId: "workspace-1",
          resolvedById: "owner-1",
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("revokes GRANTED to REVOKED", async () => {
      accessFindFirst.mockResolvedValue(
        baseAccess({ status: CoworkerWorkspaceAccessStatus.GRANTED }),
      );
      accessUpdate.mockResolvedValue(
        baseAccess({
          status: CoworkerWorkspaceAccessStatus.REVOKED,
          resolvedById: "owner-1",
        }),
      );

      const result = await revokeCoworkerWorkspaceAccess({
        accessId: "access-1",
        workspaceId: "workspace-1",
        resolvedById: "owner-1",
      });

      expect(result.access.status).toBe(CoworkerWorkspaceAccessStatus.REVOKED);
      expect(result.membershipStatusMessages).toEqual([]);
      expect(accessUpdate).toHaveBeenCalledWith({
        where: { id: "access-1" },
        data: {
          status: CoworkerWorkspaceAccessStatus.REVOKED,
          resolvedAt: expect.any(Date),
          resolvedById: "owner-1",
        },
        include: {
          coworker: {
            select: { name: true, slug: true },
          },
          workspace: {
            select: {
              id: true,
              userId: true,
              organizationId: true,
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
              organization: {
                select: {
                  name: true,
                  slug: true,
                },
              },
            },
          },
        },
      });
    });

    it("detaches org-room chat memberships after revoke", async () => {
      accessFindFirst.mockResolvedValue(
        baseAccess({ status: CoworkerWorkspaceAccessStatus.GRANTED }),
      );
      accessUpdate.mockResolvedValue(
        baseAccess({
          status: CoworkerWorkspaceAccessStatus.REVOKED,
          resolvedById: "owner-1",
        }),
      );
      chatRoomCoworkerMemberFindMany.mockResolvedValue([
        { roomId: "room-org-1", room: { kind: "channel" } },
      ]);
      const statusMessage = {
        id: "status-msg-1",
        roomId: "room-org-1",
        content: "Ops Pilot left",
      };
      recordChannelMembershipStatusMock.mockResolvedValue([statusMessage]);

      const result = await revokeCoworkerWorkspaceAccess({
        accessId: "access-1",
        workspaceId: "workspace-1",
        resolvedById: "owner-1",
      });

      expect(chatRoomMentionUpdateMany).toHaveBeenCalledWith({
        where: {
          coworkerId: "coworker-1",
          status: { in: ["pending", "sent"] },
          message: {
            room: { organizationId: "org-1" },
          },
        },
        data: {
          status: "failed",
          error: "Coworker is no longer a member of this room",
        },
      });
      expect(chatRoomCoworkerMemberDeleteMany).toHaveBeenCalledWith({
        where: {
          coworkerId: "coworker-1",
          room: { organizationId: "org-1" },
        },
      });
      expect(recordChannelMembershipStatusMock).toHaveBeenCalledWith(
        expect.anything(),
        {
          roomId: "room-org-1",
          roomKind: "channel",
          changes: [
            {
              action: "left",
              subject: {
                type: "coworker",
                id: "coworker-1",
                name: "Ops Pilot",
              },
            },
          ],
        },
      );
      expect(result.membershipStatusMessages).toEqual([statusMessage]);
    });

    it("detaches personal-room chat memberships after revoke", async () => {
      accessFindFirst.mockResolvedValue(
        baseAccess({
          status: CoworkerWorkspaceAccessStatus.GRANTED,
          workspace: {
            id: "workspace-personal",
            userId: "owner-1",
            organizationId: null,
            user: { name: "Owner", email: "owner@example.com" },
            organization: null,
          },
        }),
      );
      accessUpdate.mockResolvedValue(
        baseAccess({
          status: CoworkerWorkspaceAccessStatus.REVOKED,
          resolvedById: "owner-1",
          workspace: {
            id: "workspace-personal",
            userId: "owner-1",
            organizationId: null,
            user: { name: "Owner", email: "owner@example.com" },
            organization: null,
          },
        }),
      );
      chatRoomCoworkerMemberFindMany.mockResolvedValue([
        { roomId: "room-dm-1", room: { kind: "direct" } },
      ]);

      await revokeCoworkerWorkspaceAccess({
        accessId: "access-1",
        workspaceId: "workspace-personal",
        resolvedById: "owner-1",
      });

      expect(chatRoomCoworkerMemberDeleteMany).toHaveBeenCalledWith({
        where: {
          coworkerId: "coworker-1",
          room: {
            organizationId: null,
            userMembers: { some: { userId: "owner-1" } },
          },
        },
      });
      expect(chatRoomMentionUpdateMany).toHaveBeenCalledWith({
        where: {
          coworkerId: "coworker-1",
          status: { in: ["pending", "sent"] },
          message: {
            room: {
              organizationId: null,
              userMembers: { some: { userId: "owner-1" } },
            },
          },
        },
        data: {
          status: "failed",
          error: "Coworker is no longer a member of this room",
        },
      });
      // Directs: skip status recorder entirely (no timeline for non-channels).
      expect(recordChannelMembershipStatusMock).not.toHaveBeenCalled();
    });

    it("skips chat detach when coworker remains usable after revoke", async () => {
      accessFindFirst.mockResolvedValue(
        baseAccess({ status: CoworkerWorkspaceAccessStatus.GRANTED }),
      );
      accessUpdate.mockResolvedValue(
        baseAccess({
          status: CoworkerWorkspaceAccessStatus.REVOKED,
          resolvedById: "owner-1",
        }),
      );
      // e.g. globally whitelisted marketplace coworker
      coworkerFindFirst.mockResolvedValue({ id: "coworker-1" });

      const result = await revokeCoworkerWorkspaceAccess({
        accessId: "access-1",
        workspaceId: "workspace-1",
        resolvedById: "owner-1",
      });

      expect(coworkerFindFirst).toHaveBeenCalledWith({
        where: {
          id: "coworker-1",
          archivedAt: null,
          OR: [
            { isWhitelisted: true },
            {
              workspaceAccess: {
                some: {
                  workspaceId: "workspace-1",
                  status: CoworkerWorkspaceAccessStatus.GRANTED,
                },
              },
            },
          ],
        },
        select: { id: true },
      });
      expect(chatRoomCoworkerMemberFindMany).not.toHaveBeenCalled();
      expect(chatRoomCoworkerMemberDeleteMany).not.toHaveBeenCalled();
      expect(chatRoomMentionUpdateMany).not.toHaveBeenCalled();
      expect(recordChannelMembershipStatusMock).not.toHaveBeenCalled();
      expect(result.membershipStatusMessages).toEqual([]);
    });

    it("rejects revoke when not GRANTED", async () => {
      accessFindFirst.mockResolvedValue(
        baseAccess({ status: CoworkerWorkspaceAccessStatus.PENDING }),
      );

      await expect(
        revokeCoworkerWorkspaceAccess({
          accessId: "access-1",
          workspaceId: "workspace-1",
          resolvedById: "owner-1",
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(chatRoomCoworkerMemberDeleteMany).not.toHaveBeenCalled();
    });

    it("throws notFound when access row missing for workspace", async () => {
      accessFindFirst.mockResolvedValue(null);

      await expect(
        approveCoworkerWorkspaceAccess({
          accessId: "access-1",
          workspaceId: "workspace-1",
          resolvedById: "owner-1",
        }),
      ).rejects.toMatchObject({
        status: 404,
        message: "Coworker workspace access not found",
      });
    });
  });

  describe("notifyWorkspaceApproversOfPendingCoworkerAccess", () => {
    it("notifies personal workspace owner", async () => {
      workspaceFindUnique.mockResolvedValue({
        userId: "owner-1",
        organizationId: null,
        organization: null,
      });
      coworkerFindUnique.mockResolvedValue({
        name: "Pilot Coworker",
        slug: "pilot-coworker",
      });

      await notifyWorkspaceApproversOfPendingCoworkerAccess({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        accessId: "access-1",
      });

      expect(createNotificationMock).toHaveBeenCalledWith(
        {
          userId: "owner-1",
          kind: "SYSTEM",
          referenceId: "access-1",
          eventId: "access-1",
          messageKey: "notifications.coworkerAccess.pending",
          messageParams: {
            coworkerName: "Pilot Coworker",
            coworkerSlug: "pilot-coworker",
            workspaceId: "workspace-1",
            organizationId: null,
            organizationSlug: null,
          },
          metadata: {
            coworkerId: "coworker-1",
            workspaceId: "workspace-1",
            organizationId: null,
            organizationSlug: null,
          },
        },
        expect.anything(),
      );
    });

    it("falls back to coworkerId when coworker row missing", async () => {
      workspaceFindUnique.mockResolvedValue({
        userId: "owner-1",
        organizationId: null,
        organization: null,
      });
      coworkerFindUnique.mockResolvedValue(null);

      await notifyWorkspaceApproversOfPendingCoworkerAccess({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        accessId: "access-1",
      });

      expect(createNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messageParams: expect.objectContaining({
            coworkerName: "coworker-1",
            coworkerSlug: null,
          }),
        }),
        expect.anything(),
      );
    });

    it("notifies org OWNER and ADMIN members with organizationSlug", async () => {
      workspaceFindUnique.mockResolvedValue({
        userId: null,
        organizationId: "org-1",
        organization: { slug: "acme" },
      });
      memberFindMany.mockResolvedValue([
        { userId: "admin-1" },
        { userId: "owner-1" },
      ]);
      coworkerFindUnique.mockResolvedValue({
        name: "Pilot Coworker",
        slug: "pilot-coworker",
      });

      await notifyWorkspaceApproversOfPendingCoworkerAccess({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        accessId: "access-1",
      });

      expect(memberFindMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          role: { in: [MemberRole.OWNER, MemberRole.ADMIN] },
        },
        select: { userId: true },
      });
      expect(createNotificationMock).toHaveBeenCalledTimes(2);
      expect(createNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "admin-1",
          metadata: expect.objectContaining({
            organizationId: "org-1",
            organizationSlug: "acme",
          }),
          messageParams: expect.objectContaining({
            organizationSlug: "acme",
          }),
        }),
        expect.anything(),
      );
    });
  });

  describe("listCoworkerAccessForWorkspace", () => {
    it("lists access rows for workspace", async () => {
      const rows = [baseAccess()];
      accessFindMany.mockResolvedValue(rows);

      const result = await listCoworkerAccessForWorkspace("workspace-1");

      expect(result).toEqual(rows);
      expect(accessFindMany).toHaveBeenCalledWith({
        where: { workspaceId: "workspace-1" },
        orderBy: { createdAt: "desc" },
        include: {
          coworker: {
            select: { name: true, slug: true },
          },
          workspace: {
            select: {
              id: true,
              userId: true,
              organizationId: true,
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
              organization: {
                select: {
                  name: true,
                  slug: true,
                },
              },
            },
          },
        },
      });
    });
  });

  describe("forceRevokeCoworkerWorkspaceAccessByPair", () => {
    it("revokes GRANTED access by coworker/workspace pair", async () => {
      const granted = baseAccess({
        status: CoworkerWorkspaceAccessStatus.GRANTED,
      });
      accessFindUnique
        .mockResolvedValueOnce(granted)
        .mockResolvedValueOnce(granted);
      accessUpdate.mockResolvedValue({
        ...granted,
        status: CoworkerWorkspaceAccessStatus.REVOKED,
        resolvedById: "admin-1",
      });

      chatRoomCoworkerMemberFindMany.mockResolvedValue([
        { roomId: "room-org-1", room: { kind: "channel" } },
      ]);
      recordChannelMembershipStatusMock.mockResolvedValue([
        { id: "status-msg-force", roomId: "room-org-1" },
      ]);

      const result = await forceRevokeCoworkerWorkspaceAccessByPair({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        resolvedById: "admin-1",
      });

      expect(result.access.status).toBe(CoworkerWorkspaceAccessStatus.REVOKED);
      expect(accessUpdate).toHaveBeenCalledWith({
        where: { id: granted.id },
        data: expect.objectContaining({
          status: CoworkerWorkspaceAccessStatus.REVOKED,
          resolvedById: "admin-1",
        }),
        include: {
          coworker: {
            select: { name: true, slug: true },
          },
          workspace: {
            select: {
              id: true,
              userId: true,
              organizationId: true,
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
              organization: {
                select: {
                  name: true,
                  slug: true,
                },
              },
            },
          },
        },
      });
      expect(chatRoomCoworkerMemberDeleteMany).toHaveBeenCalledWith({
        where: {
          coworkerId: "coworker-1",
          room: { organizationId: "org-1" },
        },
      });
      expect(chatRoomMentionUpdateMany).toHaveBeenCalledWith({
        where: {
          coworkerId: "coworker-1",
          status: { in: ["pending", "sent"] },
          message: {
            room: { organizationId: "org-1" },
          },
        },
        data: {
          status: "failed",
          error: "Coworker is no longer a member of this room",
        },
      });
      expect(recordChannelMembershipStatusMock).toHaveBeenCalledWith(
        expect.anything(),
        {
          roomId: "room-org-1",
          roomKind: "channel",
          changes: [
            {
              action: "left",
              subject: {
                type: "coworker",
                id: "coworker-1",
                name: "Ops Pilot",
              },
            },
          ],
        },
      );
      expect(result.membershipStatusMessages).toHaveLength(1);
    });

    it("skips chat detach when coworker remains usable after force-revoke", async () => {
      const granted = baseAccess({
        status: CoworkerWorkspaceAccessStatus.GRANTED,
      });
      accessFindUnique
        .mockResolvedValueOnce(granted)
        .mockResolvedValueOnce(granted);
      accessUpdate.mockResolvedValue({
        ...granted,
        status: CoworkerWorkspaceAccessStatus.REVOKED,
        resolvedById: "admin-1",
      });
      coworkerFindFirst.mockResolvedValue({ id: "coworker-1" });

      const result = await forceRevokeCoworkerWorkspaceAccessByPair({
        coworkerId: "coworker-1",
        workspaceId: "workspace-1",
        resolvedById: "admin-1",
      });

      expect(result.access.status).toBe(CoworkerWorkspaceAccessStatus.REVOKED);
      expect(chatRoomCoworkerMemberDeleteMany).not.toHaveBeenCalled();
      expect(recordChannelMembershipStatusMock).not.toHaveBeenCalled();
      expect(result.membershipStatusMessages).toEqual([]);
    });

    it("throws when access row missing", async () => {
      accessFindUnique.mockResolvedValue(null);

      await expect(
        forceRevokeCoworkerWorkspaceAccessByPair({
          coworkerId: "coworker-1",
          workspaceId: "workspace-1",
          resolvedById: "admin-1",
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(chatRoomCoworkerMemberDeleteMany).not.toHaveBeenCalled();
    });

    it("throws when status is not GRANTED", async () => {
      const pending = baseAccess({
        status: CoworkerWorkspaceAccessStatus.PENDING,
      });
      accessFindUnique
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(pending);

      await expect(
        forceRevokeCoworkerWorkspaceAccessByPair({
          coworkerId: "coworker-1",
          workspaceId: "workspace-1",
          resolvedById: "admin-1",
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(chatRoomCoworkerMemberDeleteMany).not.toHaveBeenCalled();
    });
  });
});
