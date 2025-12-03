import { z } from "@hono/zod-openapi";

export const agentSchema = z
  .object({
    id: z.string().openapi({ example: "agent_123" }),
    name: z.string().openapi({ example: "Research Assistant" }),
  })
  .openapi("Agent");

export const agentsSchema = z.array(agentSchema);
