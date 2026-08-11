import { beforeEach, describe, expect, it, vi } from "vitest";

const expireStalePendingInvitationsMock = vi.fn();

vi.mock("@/helpers/chat-room-invitation", () => ({
  expireStalePendingInvitations: (...args: unknown[]) =>
    expireStalePendingInvitationsMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { tag: "prisma" },
}));

import { chatRoomGuestInvitationSyncService } from "./chat-room-guest-invitation-sync.service";

describe("chatRoomGuestInvitationSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expireStalePendingInvitationsMock.mockResolvedValue(3);
  });

  it("expires all past-due pending guest invitations", async () => {
    const now = new Date("2026-08-11T03:00:00.000Z");

    await expect(
      chatRoomGuestInvitationSyncService.expireStaleGuestInvitations({ now }),
    ).resolves.toEqual({ expired: 3 });

    expect(expireStalePendingInvitationsMock).toHaveBeenCalledWith(
      { tag: "prisma" },
      { now },
    );
  });

  it("skips the write when the sync abort signal is already aborted", async () => {
    const abortSignal = AbortSignal.abort();

    await expect(
      chatRoomGuestInvitationSyncService.expireStaleGuestInvitations({
        abortSignal,
      }),
    ).resolves.toEqual({ expired: 0 });

    expect(expireStalePendingInvitationsMock).not.toHaveBeenCalled();
  });
});
