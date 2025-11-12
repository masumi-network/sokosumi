import { z } from "@hono/zod-openapi";

console.log("[module-load]", import.meta.url);

export const agentSchema = z
  .object({
    id: z.string().openapi({ example: "agent_123" }),
    name: z.string().openapi({ example: "Research Assistant" }),
  })
  .openapi("Agent");
