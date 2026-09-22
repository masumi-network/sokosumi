import { z } from "zod";

import { SOKO_BOT_ROUTES } from "./policy.js";
import type { SokoBotContextPacket } from "./runtime.js";

const jsonObjectSchema = z.record(z.string(), z.json());

const sokoBotContextPacketTriggerSchema = z.object({
  source: z.enum(["CHAT", "SCHEDULE", "ADMIN_RETRY", "EVENT", "INGEST"]),
  route: z.enum(SOKO_BOT_ROUTES),
  confidence: z.number(),
  requestedOutcome: z.string(),
  askedBy: z.object({
    kind: z.enum(["OWNER", "TEAMMATE", "ASSISTANT"]),
    name: z.string().nullable(),
    trust: z.literal("untrusted-data"),
  }),
});

type ContextPacketTrigger = z.infer<typeof sokoBotContextPacketTriggerSchema>;

const _triggerMatchesExportedContract: ContextPacketTrigger extends SokoBotContextPacket["trigger"]
  ? SokoBotContextPacket["trigger"] extends ContextPacketTrigger
    ? true
    : never
  : never = true;

void _triggerMatchesExportedContract;

export const sokoBotContextPacketSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  hash: z.string(),
  trigger: sokoBotContextPacketTriggerSchema,
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
});
