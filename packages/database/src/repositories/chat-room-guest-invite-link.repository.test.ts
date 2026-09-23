import assert from "node:assert/strict";

import { describe, it } from "vitest";

import type { Prisma } from "../generated/prisma/client.js";
import { chatRoomGuestInviteLinkRepository } from "./chat-room-guest-invite-link.repository.js";

describe("chatRoomGuestInviteLinkRepository", () => {
  it("tryConsumeInviteLink increments when live and under maxUses", async () => {
    let updateManyArgs: unknown;
    const tx = {
      chatRoomGuestInviteLink: {
        updateMany: async (args: unknown) => {
          updateManyArgs = args;
          return { count: 1 };
        },
      },
    } as unknown as Prisma.TransactionClient;

    const now = new Date("2026-08-05T00:00:00.000Z");
    const ok = await chatRoomGuestInviteLinkRepository.tryConsumeInviteLink(
      { id: "link_1", now, maxUses: 5 },
      tx,
    );

    assert.equal(ok, true);
    assert.deepEqual(updateManyArgs, {
      where: {
        id: "link_1",
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        useCount: { lt: 5 },
      },
      data: { useCount: { increment: 1 } },
    });
  });

  it("countLiveInviteLinksByRoomId includes never-expiring and non-expired links", async () => {
    let countArgs: unknown;
    const tx = {
      chatRoomGuestInviteLink: {
        count: async (args: unknown) => {
          countArgs = args;
          return 2;
        },
      },
    } as unknown as Prisma.TransactionClient;

    const now = new Date("2026-08-05T00:00:00.000Z");
    const n =
      await chatRoomGuestInviteLinkRepository.countLiveInviteLinksByRoomId(
        "room_1",
        now,
        tx,
      );

    assert.equal(n, 2);
    assert.deepEqual(countArgs, {
      where: {
        roomId: "room_1",
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
  });
});
