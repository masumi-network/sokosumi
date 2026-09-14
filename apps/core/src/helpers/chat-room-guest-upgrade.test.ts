import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { upgradeGuestChatRoomMembershipsToMember } from "./chat-room-guest-upgrade";

const updateManyMock = vi.fn();
const findManyMock = vi.fn();
const workspaceFindUniqueOrThrowMock = vi.fn();
const notificationUpdateManyMock = vi.fn();
const transactionMock = vi.fn();
const queryRawMock = vi.fn();
const executeRawMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
    chatRoomUserMember: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
    workspace: {
      findUniqueOrThrow: (...args: unknown[]) =>
        workspaceFindUniqueOrThrowMock(...args),
    },
    notification: {
      updateMany: (...args: unknown[]) => notificationUpdateManyMock(...args),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  updateManyMock.mockResolvedValue({ count: 0 });
  findManyMock.mockResolvedValue([]);
  workspaceFindUniqueOrThrowMock.mockResolvedValue({ id: "workspace_1" });
  notificationUpdateManyMock.mockResolvedValue({ count: 0 });
  transactionMock.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback({
      $executeRaw: executeRawMock,
      $queryRaw: queryRawMock,
      chatRoomUserMember: {
        findMany: findManyMock,
        updateMany: updateManyMock,
      },
      workspace: { findUniqueOrThrow: workspaceFindUniqueOrThrowMock },
      notification: { updateMany: notificationUpdateManyMock },
    }),
  );
});

describe("upgradeGuestChatRoomMembershipsToMember", () => {
  it("promotes guest rows on host-org channels to member", async () => {
    updateManyMock.mockResolvedValue({ count: 2 });
    findManyMock.mockResolvedValue([
      { roomId: "11111111-1111-7111-8111-111111111111" },
      { roomId: "22222222-2222-7222-8222-222222222222" },
    ]);

    await expect(
      upgradeGuestChatRoomMembershipsToMember("user_1", "org_1"),
    ).resolves.toBe(2);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        access: "guest",
        room: {
          organizationId: "org_1",
          kind: "channel",
        },
      },
      data: { access: "member" },
    });
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        kind: NotificationKind.CHAT,
        referenceId: {
          in: [
            "11111111-1111-7111-8111-111111111111",
            "22222222-2222-7222-8222-222222222222",
          ],
        },
        workspaceId: null,
        organizationId: null,
      },
      data: {
        workspaceId: "workspace_1",
        organizationId: "org_1",
      },
    });
  });

  it("uses a transaction client when provided", async () => {
    const txUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const txNotificationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([]),
      chatRoomUserMember: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { roomId: "11111111-1111-7111-8111-111111111111" },
          ]),
        updateMany: txUpdateMany,
      },
      workspace: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "workspace_1" }),
      },
      notification: { updateMany: txNotificationUpdateMany },
    };

    await expect(
      upgradeGuestChatRoomMembershipsToMember("user_1", "org_1", tx as never),
    ).resolves.toBe(1);

    expect(txUpdateMany).toHaveBeenCalled();
    expect(txNotificationUpdateMany).toHaveBeenCalled();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      txUpdateMany.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("does not touch memberships or notifications when no guest row exists", async () => {
    await expect(
      upgradeGuestChatRoomMembershipsToMember("user_1", "org_1"),
    ).resolves.toBe(0);

    expect(updateManyMock).not.toHaveBeenCalled();
    expect(notificationUpdateManyMock).not.toHaveBeenCalled();
    expect(workspaceFindUniqueOrThrowMock).not.toHaveBeenCalled();
  });
});
