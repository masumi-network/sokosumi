import { z } from "@hono/zod-openapi";
import { brandBrainSchema } from "@sokosumi/soko-bot";

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
  })
  .openapi("StudioWebsiteCopy");

export const studioBrandKitSchema = z
  .object({
    logo: z.string().url().nullable(),
    colors: z.array(z.string()),
    fonts: z.array(z.string()),
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
