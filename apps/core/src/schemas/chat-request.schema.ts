import { z } from "@hono/zod-openapi";

export const chatRequestSchema = z.object({
  messages: z.array(
    z.object({
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
    }),
  ),
  conversationId: z.string().uuid().optional(),
  previousResponseId: z.string().optional(),
  model: z.string().nullable().optional(),
});
