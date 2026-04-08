import { z } from "@hono/zod-openapi";

export const chatRequestMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  parts: z
    .array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
      }),
    )
    .optional(),
  content: z
    .union([
      z.string(),
      z.array(
        z.object({
          type: z.string(),
          text: z.string().optional(),
        }),
      ),
    ])
    .optional(),
  id: z.string().optional(),
});

/**
 * Body for `POST /v1/chat` (AI SDK). Supports:
 * - Full `messages[]` (e.g. regenerate), or
 * - `message` + `conversationId` + `trigger: "submit-message"` to rebuild history from DB.
 */
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
        message:
          "Provide non-empty messages, or conversationId with message and trigger submit-message.",
        path: ["messages"],
      });
    }
  });
