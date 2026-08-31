import { z } from "@hono/zod-openapi";

import { userSummarySchema } from "@/schemas/user.schema";

export const orchestratorSummarySchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    name: z.string().nullable().openapi({ example: "Atlas" }),
    avatarSeed: z.string().nullable().openapi({
      example: "orb:jewel-sky:user_123",
    }),
    /** A claimed mascot. When set it is the bot's face; the orb is the fallback. */
    avatarImageUrl: z.string().nullable().openapi({
      example: "https://blob.example/mascot.png",
    }),
    owner: userSummarySchema,
  })
  .openapi("OrchestratorSummary");

export type OrchestratorSummary = z.infer<typeof orchestratorSummarySchema>;
