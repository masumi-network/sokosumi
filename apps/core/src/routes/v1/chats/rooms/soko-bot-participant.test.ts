import { describe, expect, it } from "vitest";

import { chatRoomSokoBotParticipantSchema } from "@/schemas/chat-room-participant.schema";

import {
  type ChatRoomSokoBotRow,
  mapChatRoomSokoBotParticipant,
} from "./soko-bot-participant";

const BOT_ID = "01960001-0001-7001-8001-000000000099";

function row(overrides: Partial<ChatRoomSokoBotRow> = {}): ChatRoomSokoBotRow {
  return {
    id: BOT_ID,
    name: "Zero",
    avatarImageUrl: null,
    avatarSeed: null,
    userId: "user_ana",
    projectId: null,
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
      ownerUserId: "user_ana",
      scope: "personal",
      presence: "online",
    });
    expect(chatRoomSokoBotParticipantSchema.parse(participant)).toEqual(
      participant,
    );
  });

  it.each([
    ["project", "project_1", "Project assistant"],
    ["workspace", null, "Workspace assistant"],
  ] as const)(
    "shows a shared %s bot with no owner, seeded from its own id",
    (scope, projectId, caption) => {
      const participant = mapChatRoomSokoBotParticipant(
        row({ userId: null, projectId, user: null }),
      );

      expect(participant).toMatchObject({
        caption,
        avatarSeed: `orb:${BOT_ID}`,
        ownerUserId: null,
        scope,
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
