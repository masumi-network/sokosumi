import { AgentStatus } from "@sokosumi/database";
import * as z from "zod";

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
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(AgentStatus),
  isShown: z.boolean(),
  price: creditsPriceSchema,
  tags: z.array(agentTagSchema),
});

// Type exports for use in API routes
export type CreditsPriceResponse = z.infer<typeof creditsPriceSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;
