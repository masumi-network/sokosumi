import { z } from "@hono/zod-openapi";
import { cmoBrandBrainSchema } from "@sokosumi/soko-bot";

import { dateTimeSchema } from "@/helpers/datetime";

export const brandBrainProjectParamsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
});

export const brandBrainSchema = z
  .object({
    brandBrain: z
      .union([cmoBrandBrainSchema, z.null()])
      .describe("Null until its essentials are saved."),
    updatedAt: z
      .union([dateTimeSchema, z.null()])
      .describe("When the essentials were last saved."),
    confirmedAt: z.union([dateTimeSchema, z.null()]),
    confirmedBy: z
      .union([z.object({ id: z.string(), name: z.string() }), z.null()])
      .describe("The member who last confirmed it."),
  })
  .openapi("BrandBrain");

export const brandBrainRequestSchema = z
  .object({ brandBrain: cmoBrandBrainSchema })
  .openapi("BrandBrainRequest");
