import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const orchestratorSummarySchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    name: z.string().openapi({ example: "Hermes" }),
    slug: z.string().openapi({ example: "hermes" }),
    image: z
      .string()
      .nullable()
      .openapi({ example: "https://example.com/hermes.png" }),
  })
  .openapi("OrchestratorSummary");

export type OrchestratorSummary = z.infer<typeof orchestratorSummarySchema>;

export const orchestratorSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    archivedAt: dateTimeSchema.nullable(),
    slug: z.string().openapi({ example: "hermes" }),
    name: z.string().openapi({ example: "Hermes" }),
    caption: z
      .string()
      .nullable()
      .openapi({ example: "Sokosumi orchestrator" }),
    description: z
      .string()
      .nullable()
      .openapi({ example: "First-party Hermes orchestrator" }),
    image: z
      .string()
      .nullable()
      .openapi({ example: "https://example.com/hermes.png" }),
  })
  .openapi("Orchestrator");

export type Orchestrator = z.infer<typeof orchestratorSchema>;
