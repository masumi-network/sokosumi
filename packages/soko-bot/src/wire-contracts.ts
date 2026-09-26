import { z } from "zod";

const jsonObjectSchema = z.record(z.string(), z.json());

export const sokoBotContextPacketSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  hash: z.string(),
  trigger: jsonObjectSchema,
  actor: jsonObjectSchema,
  workspace: jsonObjectSchema,
  projects: z.array(jsonObjectSchema),
  tasks: z.array(jsonObjectSchema),
  coworkers: z.array(jsonObjectSchema),
  agents: z.array(jsonObjectSchema),
  jobs: z.array(jsonObjectSchema),
  pendingDecisions: z.array(jsonObjectSchema),
  recentTurns: z.array(jsonObjectSchema),
  memory: z.object({
    version: z.number().int().nonnegative(),
    hash: z.string().nullable(),
    markdown: z.string(),
  }),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  omissions: z.record(z.string(), z.number().int().nonnegative()),
  sourceCoverage: z
    .record(
      z.string(),
      z.object({
        source: z.string(),
        checkedAt: z.string().datetime().nullable(),
        filters: z.record(z.string(), z.string()),
        scannedCount: z.number().int().nonnegative(),
        includedCount: z.number().int().nonnegative(),
        omittedCount: z.number().int().nonnegative(),
        completeness: z.enum(["COMPLETE", "TRUNCATED", "NOT_CHECKED"]),
        availability: z.enum([
          "AVAILABLE",
          "DISCONNECTED",
          "PERMISSION_DENIED",
          "QUERY_FAILED",
          "NOT_FETCHED",
        ]),
      }),
    )
    .optional(),
});
