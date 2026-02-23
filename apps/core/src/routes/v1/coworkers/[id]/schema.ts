import { z } from "@hono/zod-openapi";

export const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cow_123",
  }),
});

export const apiKeyParamsSchema = paramsSchema.extend({
  keyId: z.string().openapi({
    param: { name: "keyId", in: "path" },
    example: "cokey_123",
  }),
});
