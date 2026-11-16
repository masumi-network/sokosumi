import { z } from "@hono/zod-openapi";
import { brandBrainSchema } from "@sokosumi/soko-bot";

import { studioLogoPositionOrNullSchema } from "./studio-logo-position.schema";
import { studioProductImportSchema } from "./studio-product.schema";

export const studioBrandCopySchema = z
  .object({
    summary: brandBrainSchema.shape.summary,
    tone: brandBrainSchema.shape.voice.shape.tone,
    audience: brandBrainSchema.shape.audience,
    approvedLines: brandBrainSchema.shape.voice.shape.examples,
  })
  .openapi("StudioBrandCopy");

export type StudioBrandCopy = z.infer<typeof studioBrandCopySchema>;

export const studioWebsiteCopySchema = z
  .object({
    summary: studioBrandCopySchema.shape.summary.nullable(),
    lines: studioBrandCopySchema.shape.approvedLines,
    tone: studioBrandCopySchema.shape.tone.optional(),
    audience: studioBrandCopySchema.shape.audience.optional(),
  })
  .openapi("StudioWebsiteCopy");

export const studioBrandLookSchema = z
  .object({
    colors: z
      .array(
        z
          .string()
          .trim()
          .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i),
      )
      .max(8),
    fonts: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[^\p{Cc}\p{Cf}]+$/u),
      )
      .max(4),
  })
  .openapi("StudioBrandLook");

const studioWebsiteVisualSchema = studioBrandLookSchema
  .extend({ logo: z.url().nullable() })
  .openapi("StudioWebsiteVisual");

export const studioWebsiteDraftSchema = z
  .object({
    brandCopy: z.union([studioWebsiteCopySchema, z.null()]),
    products: studioProductImportSchema.shape.products.nullable(),
    visual: z.union([studioWebsiteVisualSchema, z.null()]).optional(),
  })
  .openapi("StudioWebsiteDraft");

const studioBrandLookRevision = z.number().int().nonnegative();

export const studioBrandLookStateSchema = z
  .object({
    colors: z.array(z.string()),
    fonts: z.array(z.string()),
    lookRevision: studioBrandLookRevision,
    hasCustomLook: z.boolean(),
  })
  .openapi("StudioBrandLookState");

export const saveStudioBrandLookSchema = z
  .object({
    look: z.union([studioBrandLookSchema, z.null()]),
    lookRevision: studioBrandLookRevision,
  })
  .openapi("SaveStudioBrandLook");

export type SaveStudioBrandLook = z.infer<typeof saveStudioBrandLookSchema>;

export const studioBrandKitSchema = z
  .object({
    logo: z.string().url().nullable(),
    studioLogoPosition: studioLogoPositionOrNullSchema.optional(),
    colors: z.array(z.string()),
    fonts: z.array(z.string()),
    lookRevision: studioBrandLookRevision.optional(),
    hasCustomLook: z.boolean().optional(),
    summary: z.string(),
    tone: z.string(),
    audience: studioBrandCopySchema.shape.audience,
    approvedLines: studioBrandCopySchema.shape.approvedLines,
    version: z.string().datetime().nullable(),
  })
  .openapi("StudioBrandKit");

export const saveStudioBrandCopySchema = z
  .object({
    copy: studioBrandCopySchema,
    version: studioBrandKitSchema.shape.version,
  })
  .openapi("SaveStudioBrandCopy");
