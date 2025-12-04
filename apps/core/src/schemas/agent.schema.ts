import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const agentSchema = z
  .object({
    id: z.string().openapi({ example: "agent_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    name: z.string().openapi({ example: "Research Assistant" }),
  })
  .openapi("Agent");

export const agentsSchema = z.array(agentSchema);
