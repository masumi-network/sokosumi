import { z } from "@hono/zod-openapi";

import { chatMessageContentPartSchema } from "@/schemas/chat-ui-message.schema";

/** Used by Zod and POST /v1/chat (defense in depth) when `messages` is missing or empty. */
export const AI_SDK_CHAT_MESSAGES_REQUIREMENT =
  "Provide non-empty messages, or conversationId with message and trigger submit-message.";

export const chatRequestMessagePartSchema = chatMessageContentPartSchema;

export const chatRequestMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(chatRequestMessagePartSchema).optional(),
  content: z
    .union([z.string(), z.array(chatRequestMessagePartSchema)])
    .optional(),
  metadata: z
    .object({
      imageGeneration: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
  id: z.string().optional(),
});

/** POST /v1/chat: messages[] or message + conversationId + trigger submit-message. */
export const aiSdkChatRequestSchema = z
  .object({
    messages: z.array(chatRequestMessageSchema).optional(),
    message: chatRequestMessageSchema.optional(),
    id: z.string().optional(),
    trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
    messageId: z.string().optional(),
    conversationId: z.string().uuid().optional(),
    previousResponseId: z.string().optional(),
    model: z.string().nullable().optional(),
    imageGeneration: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const useServerHistory =
      Boolean(data.conversationId) &&
      data.message !== undefined &&
      data.trigger === "submit-message";
    const hasMessages =
      Array.isArray(data.messages) && data.messages.length > 0;
    if (!useServerHistory && !hasMessages) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: AI_SDK_CHAT_MESSAGES_REQUIREMENT,
        path: ["messages"],
      });
    }
    if (data.conversationId) {
      if (typeof data.id !== "string" || data.id.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "id is required when conversationId is set.",
          path: ["id"],
        });
        return;
      }
      if (data.id !== data.conversationId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "id must match conversationId.",
          path: ["id"],
        });
      }
    }
  });

/**
 * POST /v1/chats/rooms/{id}/stream — AI SDK chat body plus optional thread parent
 * and optional same-room quote (snapshot stored in metadata.quote; does not set
 * parentMessageId). `roomId` is accepted when the web proxy forwards it; Core
 * uses the path id.
 */
export const roomStreamRequestSchema = aiSdkChatRequestSchema.and(
  z.object({
    parentMessageId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
    quote: z
      .object({
        messageId: z.string().uuid(),
      })
      .optional(),
  }),
);
