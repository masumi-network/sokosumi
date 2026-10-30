import { z } from "@hono/zod-openapi";

export const chatRoomPresenceSchema = z
  .enum(["online", "afk", "offline"])
  .openapi("ChatRoomPresence");

export const chatRoomSokoBotScopeSchema = z
  .enum(["personal", "project", "workspace"])
  .openapi("ChatRoomSokoBotScope", {
    description:
      "Who the Soko Bot belongs to: one person, a Project, or the whole workspace.",
    example: "personal",
  });

export const chatRoomSokoBotParticipantSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    name: z.string().openapi({ example: "Soko Bot" }),
    caption: z
      .string()
      .nullable()
      .openapi({ example: "Jane's personal assistant" }),
    image: z
      .string()
      .nullable()
      .openapi({ example: "https://example.com/soko-bot.png" }),
    avatarSeed: z.string().nullable().openapi({ example: "orb:user_123" }),
    avatarStyleId: z.string().nullable().optional().openapi({
      description:
        "The style of the bot's claimed avatar, null when it has none. Always sent; optional so clients written before it compile.",
      example: "crafted-desk",
    }),
    workingLoopUrl: z.string().nullable().optional().openapi({
      description:
        "The bot's Working loop (silent MP4), played on its face while a reply is in progress. Null for a mascot or before the loop is rendered. Always sent; optional so clients written before it compile.",
      example: "https://example.com/working-480.mp4",
    }),
    ownerUserId: z.string().nullable().openapi({
      description:
        "The user who owns this personal Soko Bot. Only the owner may add it to or remove it from a Channel. Null for a shared Soko Bot, which any member may add or remove.",
      example: "user_123",
    }),
    scope: chatRoomSokoBotScopeSchema,
    sharedRoomId: z.string().uuid().nullable().openapi({
      description:
        "The shared Soko Bot's own room. The bot stays in it and nobody can remove it there. Null for a personal Soko Bot, or before the room exists.",
      example: "01960001-0001-7001-8001-0000000000ab",
    }),
    presence: chatRoomPresenceSchema.openapi({ example: "online" }),
  })
  .openapi("ChatRoomSokoBotParticipant");

export type ChatRoomSokoBotParticipant = z.infer<
  typeof chatRoomSokoBotParticipantSchema
>;
