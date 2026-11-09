import { z } from "@hono/zod-openapi";

export const savedMessageParamsSchema = z.object({
  messageId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "messageId", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440001",
    }),
});
