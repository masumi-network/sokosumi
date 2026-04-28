import { z } from "@hono/zod-openapi";

import { chatMessageContentPartSchema } from "@/schemas/chat-ui-message.schema";

export const conversationMessageContentPartSchema =
  chatMessageContentPartSchema;

export const conversationMessageSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "Conversation message ID",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    role: z.enum(["user", "assistant", "system"]).openapi({
      description: "Message role",
      example: "user",
    }),
    content: z
      .union([z.string(), z.array(conversationMessageContentPartSchema)])
      .openapi({
        description:
          "Message content — string for plain text, or array of typed parts",
        example: "Hello!",
      }),
    createdAt: z.number().openapi({
      description: "Unix timestamp in seconds",
      example: 1706284800,
    }),
    thoughtTiming: z
      .object({
        startedAtMs: z.coerce.number(),
        endedAtMs: z.coerce.number(),
      })
      .optional()
      .openapi({
        description:
          "Wall-clock thought phase (ms since epoch), when persisted for coworker reasoning",
      }),
  })
  .openapi("ConversationMessage");

export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const createConversationMessageRequestSchema = z
  .object({
    role: z.enum(["user", "assistant", "system"]).openapi({
      description: "Message role",
      example: "user",
    }),
    content: z
      .union([z.string(), z.array(conversationMessageContentPartSchema)])
      .openapi({
        description:
          "Message content — string for plain text, or array of typed parts",
        example: "Hello!",
      }),
  })
  .openapi("CreateConversationMessageRequest");

export type CreateConversationMessageRequest = z.infer<
  typeof createConversationMessageRequestSchema
>;
