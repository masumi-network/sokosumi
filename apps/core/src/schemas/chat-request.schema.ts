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
