import { z } from "@hono/zod-openapi";
import { CMO_BRAND_ANSWERS, cmoBrandBrainSchema } from "@sokosumi/soko-bot";

import { dateTimeSchema } from "@/helpers/datetime";
import {
  parseCmoBrandBrain,
  type StoredBrandBrain,
} from "@/services/brand-brain.service";

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

export function mapBrandBrainForApi(stored: StoredBrandBrain | null) {
  return brandBrainSchema.parse({
    brandBrain: parseCmoBrandBrain(stored?.body),
    updatedAt: stored?.updatedAt ?? null,
    confirmedAt: stored?.confirmedAt ?? null,
    confirmedBy: stored?.confirmedBy ?? null,
  });
}

export const brandBrainRequestSchema = z
  .object({ brandBrain: cmoBrandBrainSchema })
  .openapi("BrandBrainRequest");

export const brandBrainAnswerRequestSchema = z
  .object({
    questionId: z.string().trim().min(1).max(40),
    answer: z.enum(CMO_BRAND_ANSWERS),
    note: z
      .string()
      .trim()
      .max(400)
      .optional()
      .describe("After a no: what is true instead, in the member's words."),
  })
  .openapi("BrandBrainAnswerRequest");
