import { z } from "zod";

import { jobInputsDataSchema } from "@/lib/job-input";
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
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(AgentStatus),
  isNew: z.boolean(),
  isShown: z.boolean(),
  price: creditsPriceSchema,
  tags: z.array(agentTagSchema),
});

// Type exports for use in API routes
export type CreditsPriceResponse = z.infer<typeof creditsPriceSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;
export type AgentInputSchemaResponse = z.infer<
  ReturnType<typeof jobInputsDataSchema>
>;
