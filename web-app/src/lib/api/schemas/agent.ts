import { z } from "zod";

import { AgentStatus } from "@/prisma/generated/client";

// Schema for credit price with BigInt to string conversion
export const creditsPriceSchema = z.object({
  credits: z.number(),
  includedFee: z.number(),
});

// Schema for agent tag
export const agentTagSchema = z.object({
  name: z.string(),
});

// Main agent response schema
export const agentResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.nativeEnum(AgentStatus),
  isNew: z.boolean(),
  isShown: z.boolean(),
  createdAt: z.string(), // Date as ISO string
  updatedAt: z.string(), // Date as ISO string
  price: creditsPriceSchema,
  tags: z.array(agentTagSchema),
});

// Response schema for the agents list endpoint
export const agentsListResponseSchema = z.object({
  agents: z.array(agentResponseSchema),
  total: z.number(),
});

// Type exports for use in API routes
export type CreditsPriceResponse = z.infer<typeof creditsPriceSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;
export type AgentsListResponse = z.infer<typeof agentsListResponseSchema>;
