import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

import { developerSchema } from "./developer.schema";

export const agentSchema = z
  .object({
    id: z.string().openapi({ example: "agent_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    name: z.string().openapi({ example: "Research Assistant" }),
    credits: z.number().openapi({ example: 100 }),
    description: z.string().openapi({
      example: "A research assistant that can help you with your research",
    }),
    developer: developerSchema,
  })
  .openapi("Agent");

export const agentsSchema = z.array(agentSchema);
