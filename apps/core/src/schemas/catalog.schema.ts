import { z } from "@hono/zod-openapi";

import { agentDetailSchema } from "@/schemas/agent.schema";
import { coworkerSchema } from "@/schemas/coworker.schema";

export const catalogSchema = z
  .object({
    agents: z.array(agentDetailSchema).openapi({
      description: "All available agents with their full metadata.",
    }),
    coworkers: z.array(coworkerSchema).openapi({
      description: "Coworkers with their full metadata.",
    }),
  })
  .openapi("Catalog");

export type Catalog = z.infer<typeof catalogSchema>;
