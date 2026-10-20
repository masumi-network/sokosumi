import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import { requireWritableChatRoom } from "./writable-chat-room";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const ORG_ID = "org_1";
const GUEST_ID = "user_guest";
const ARCHIVED_AT = new Date("2026-10-14T12:00:00.000Z");

// A guest skips the host organization lookup, so the room row is all the
// write access reads.
function txWithRoom(room: Record<string, unknown>) {
  return {
    chatRoom: {
      findFirst: vi.fn(async () => ({
        id: ROOM_ID,
        name: "Team Bot",
        organizationId: ORG_ID,
        slug: "team-bot",
        kind: "channel",
        directKey: null,
        providerConversationId: null,
        userMembers: [
          { userId: GUEST_ID, access: "guest", user: { name: "G" } },
        ],
        coworkerMembers: [],
        sokoBotMembers: [],
        ...room,
      })),
    },
    organization: { findUnique: vi.fn(async () => ({ id: ORG_ID })) },
    member: { findUnique: vi.fn(async () => null) },
  };
}

describe("requireWritableChatRoom", () => {
  it("reads the shared bot's state with the room", async () => {
    const tx = txWithRoom({ sharedSokoBot: null });

    await requireWritableChatRoom(ROOM_ID, GUEST_ID, tx as never);

    expect(tx.chatRoom.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          sharedSokoBot: { select: { archivedAt: true, deletedAt: true } },
        }),
      }),
    );
  });

  it("lets a message into a live shared bot's room", async () => {
    const tx = txWithRoom({
      sharedSokoBot: { archivedAt: null, deletedAt: null },
    });

    await expect(
      requireWritableChatRoom(ROOM_ID, GUEST_ID, tx as never),
    ).resolves.toMatchObject({ id: ROOM_ID });
  });

  it.each([
    ["archived", { archivedAt: ARCHIVED_AT, deletedAt: null }],
    ["deleted", { archivedAt: ARCHIVED_AT, deletedAt: ARCHIVED_AT }],
  ])(
    "refuses a message in a %s shared bot's room with 403",
    async (_state, sharedSokoBot) => {
      const error = await requireWritableChatRoom(
        ROOM_ID,
        GUEST_ID,
        txWithRoom({ sharedSokoBot }) as never,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).status).toBe(403);
      expect((error as HTTPException).message).toMatch(/read-only/);
    },
  );
});
