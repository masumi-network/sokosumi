import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const orchestratorSummarySchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    name: z.string().nullable().openapi({ example: "Atlas" }),
  })
  .openapi("OrchestratorSummary");

export type OrchestratorSummary = z.infer<typeof orchestratorSummarySchema>;

export const orchestratorSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    archivedAt: dateTimeSchema.nullable(),
    userId: z.string().openapi({ example: "user_123" }),
    name: z.string().nullable().openapi({ example: "Atlas" }),
    avatarSeed: z.string().nullable().openapi({ example: "orb-seed-1" }),
    personalityTone: z.number().int().nullable().openapi({ example: 50 }),
    personalityDetail: z.number().int().nullable().openapi({ example: 50 }),
    personalityStyle: z.number().int().nullable().openapi({ example: 50 }),
    lastPolledAt: dateTimeSchema.nullable(),
    lastInboxMessageAt: dateTimeSchema.nullable(),
    lastSeenInboxAt: dateTimeSchema.nullable(),
    consecutivePollErrors: z.number().int().openapi({ example: 0 }),
  })
  .openapi("Orchestrator");

export type Orchestrator = z.infer<typeof orchestratorSchema>;
