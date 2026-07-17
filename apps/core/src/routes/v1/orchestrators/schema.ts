import { z } from "@hono/zod-openapi";

const orchestratorEditableFieldsSchema = z.object({
  name: z.string().trim().min(3).openapi({ example: "Hermes" }),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: "slug must be lowercase kebab-case",
    })
    .openapi({ example: "hermes" }),
  caption: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .nullish()
    .openapi({ example: "Sokosumi orchestrator" }),
  description: z
    .string()
    .trim()
    .min(1)
    .nullish()
    .openapi({ example: "First-party Hermes orchestrator" }),
});

export const createOrchestratorRequestSchema =
  orchestratorEditableFieldsSchema.strict();

export const patchOrchestratorRequestSchema = orchestratorEditableFieldsSchema
  .partial()
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.slug !== undefined ||
      data.caption !== undefined ||
      data.description !== undefined,
    {
      message: "At least one orchestrator field is required",
      path: ["name", "slug", "caption", "description"],
    },
  );

export const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "01960001-0001-7001-8001-000000000099",
    }),
});

export const apiKeyParamsSchema = paramsSchema.extend({
  keyId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "keyId", in: "path" },
      example: "01960001-0001-7001-8001-0000000000aa",
    }),
});

export const meApiKeyParamsSchema = z.object({
  keyId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "keyId", in: "path" },
      example: "01960001-0001-7001-8001-0000000000aa",
    }),
});
