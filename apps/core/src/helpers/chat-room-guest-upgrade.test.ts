import { beforeEach, describe, expect, it, vi } from "vitest";

import { upgradeGuestChatRoomMembershipsToMember } from "./chat-room-guest-upgrade";

const updateManyMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomUserMember: {
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  updateManyMock.mockResolvedValue({ count: 0 });
});

describe("upgradeGuestChatRoomMembershipsToMember", () => {
  it("promotes guest rows on host-org channels to member", async () => {
    updateManyMock.mockResolvedValue({ count: 2 });

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
  });

  it("uses a transaction client when provided", async () => {
    const txUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      chatRoomUserMember: { updateMany: txUpdateMany },
    };

    await expect(
      upgradeGuestChatRoomMembershipsToMember("user_1", "org_1", tx as never),
    ).resolves.toBe(1);

    expect(txUpdateMany).toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
