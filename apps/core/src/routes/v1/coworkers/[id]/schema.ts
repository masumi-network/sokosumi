import { z } from "@hono/zod-openapi";

export const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cow_123",
  }),
});

export const getCoworkerByIdQuerySchema = z.object({
  scope: z
    .enum(["owned"])
    .optional()
    .openapi({
      param: { name: "scope", in: "query" },
      description:
        "When 'owned', return the coworker only if it is active and accessible via vendor membership (vendor admin: all vendor coworkers; developer: assigned only; user-authenticated only). Omit to retrieve any coworker by ID.",
      example: "owned",
    }),
});

export const apiKeyParamsSchema = paramsSchema.extend({
  keyId: z.string().openapi({
    param: { name: "keyId", in: "path" },
    example: "cokey_123",
  }),
});
