import { describe, expect, it } from "vitest";

import { chatRoomSokoBotParticipantSchema } from "@/schemas/chat-room-participant.schema";

import {
  type ChatRoomSokoBotRow,
  chatRoomSokoBotSelect,
  mapChatRoomSokoBotParticipant,
} from "./soko-bot-participant";

const BOT_ID = "01960001-0001-7001-8001-000000000099";
const ROOM_ID = "01960001-0001-7001-8001-0000000000ab";

function row(overrides: Partial<ChatRoomSokoBotRow> = {}): ChatRoomSokoBotRow {
  return {
    id: BOT_ID,
    name: "Zero",
    avatarImageUrl: null,
    avatar: null,
    avatarSeed: null,
    userId: "user_ana",
    projectId: null,
    sharedRoomId: null,
    user: { name: "Ana Lopez" },
    ...overrides,
  };
}

describe("mapChatRoomSokoBotParticipant", () => {
  it("shows a personal bot exactly as before, with its owner", () => {
    const participant = mapChatRoomSokoBotParticipant(row());

    expect(participant).toEqual({
      id: BOT_ID,
      name: "Zero",
      caption: "Ana's personal assistant",
      image: null,
      avatarSeed: "orb:user_ana",
      avatarStyleId: null,
      idleLoopUrl: null,
      workingLoopUrl: null,
      ownerUserId: "user_ana",
      scope: "personal",
      sharedRoomId: null,
      presence: "online",
    });
    expect(chatRoomSokoBotParticipantSchema.parse(participant)).toEqual(
      participant,
    );
  });

  it("names the style of a claimed avatar", () => {
    expect(
      mapChatRoomSokoBotParticipant(
        row({ avatar: { styleId: "crafted-desk", renders: [] } }),
      ).avatarStyleId,
    ).toBe("crafted-desk");
  });

  it("carries the loops a face plays, once they are rendered", () => {
    expect(chatRoomSokoBotSelect.avatar.select.renders.where).toEqual({
      state: { in: ["IDLE", "WORKING"] },
    });
    const participant = mapChatRoomSokoBotParticipant(
      row({
        avatar: {
          styleId: "crafted-desk",
          renders: [
            { state: "WORKING", loopUrl: "https://blob/working-480.mp4" },
            { state: "IDLE", loopUrl: "https://blob/idle-480.mp4" },
          ],
        },
      }),
    );
    expect(participant.workingLoopUrl).toBe("https://blob/working-480.mp4");
    expect(participant.idleLoopUrl).toBe("https://blob/idle-480.mp4");
  });

  it("has no loop before it is rendered, and none for a bot with no avatar", () => {
    const rendering = mapChatRoomSokoBotParticipant(
      row({
        avatar: {
          styleId: "crafted-desk",
          renders: [{ state: "IDLE", loopUrl: null }],
        },
      }),
    );
    expect(rendering.idleLoopUrl).toBeNull();
    expect(rendering.workingLoopUrl).toBeNull();
    expect(mapChatRoomSokoBotParticipant(row()).idleLoopUrl).toBeNull();
  });

  it.each([
    ["project", "project_1", "Project assistant"],
    ["workspace", null, "Workspace assistant"],
  ] as const)(
    "shows a shared %s bot with no owner, seeded from its own id",
    (scope, projectId, caption) => {
      const participant = mapChatRoomSokoBotParticipant(
        row({ userId: null, projectId, sharedRoomId: ROOM_ID, user: null }),
      );

      expect(participant).toMatchObject({
        caption,
        avatarSeed: `orb:${BOT_ID}`,
        ownerUserId: null,
        scope,
        sharedRoomId: ROOM_ID,
      });
      expect(chatRoomSokoBotParticipantSchema.parse(participant)).toEqual(
        participant,
      );
    },
  );

  it("keeps a chosen avatar seed and image", () => {
    expect(
      mapChatRoomSokoBotParticipant(
        row({
          userId: null,
          user: null,
          avatarSeed: "orb:jewel-sky:x",
          avatarImageUrl: "https://example.com/bot.png",
        }),
      ),
    ).toMatchObject({
      avatarSeed: "orb:jewel-sky:x",
      image: "https://example.com/bot.png",
    });
  });
});
