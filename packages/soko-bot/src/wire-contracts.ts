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
});

export const sokoBotRuntimeContextSchema = z.object({
  packet: sokoBotContextPacketSchema,
  hash: z.string(),
  schemaVersion: z.number().int().positive(),
  generatedAt: z.string().datetime(),
});

export const sokoBotRuntimeToolResultSchema = z.json();
export const sokoBotRuntimeCommandResponseSchema = z.json();

export const eveAcceptedResponseSchema = z.object({
  sessionId: z.string().min(1),
  status: z.string().optional(),
});

export const sokoBotRuntimeEventSchema = z.object({
  type: z.string().min(1),
  data: jsonObjectSchema,
  meta: z.object({
    id: z.string().min(1),
    at: z.string().datetime(),
  }),
});

export type SokoBotRuntimeContext = z.infer<typeof sokoBotRuntimeContextSchema>;
export type SokoBotRuntimeToolResult = z.infer<
  typeof sokoBotRuntimeToolResultSchema
>;
