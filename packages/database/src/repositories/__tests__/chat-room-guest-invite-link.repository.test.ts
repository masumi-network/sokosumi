import assert from "node:assert/strict";

import { describe, it } from "vitest";

import type { Prisma } from "../../generated/prisma/client.js";
import { chatRoomGuestInviteLinkRepository } from "../chat-room-guest-invite-link.repository.js";

describe("chatRoomGuestInviteLinkRepository", () => {
  it("listInviteLinksByRoomId queries by roomId ordered by createdAt desc", async () => {
    let findManyArgs: unknown;
    const rows = [
      {
        id: "link_1",
        token: "tok_1",
        roomId: "room_1",
        createdByUserId: "user_1",
        createdAt: new Date("2026-08-01T12:00:00.000Z"),
        expiresAt: new Date("2026-08-08T12:00:00.000Z"),
        revokedAt: null,
        maxUses: null,
        useCount: 0,
      },
    ];
    const tx = {
      chatRoomGuestInviteLink: {
        findMany: async (args: unknown) => {
          findManyArgs = args;
          return rows;
        },
      },
    } as unknown as Prisma.TransactionClient;

    const result =
      await chatRoomGuestInviteLinkRepository.listInviteLinksByRoomId(
        "room_1",
        tx,
      );

    assert.equal(result, rows);
    assert.deepEqual(findManyArgs, {
      where: { roomId: "room_1" },
      orderBy: { createdAt: "desc" },
    });
  });

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
