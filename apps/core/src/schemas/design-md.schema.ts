import { z } from "@hono/zod-openapi";

export const designMdMetadataSchema = z
  .object({
    extractionId: z.string().nullable().openapi({
      description: "Masumi DESIGN.md extraction id when generated",
      example: "42",
    }),
    previewUrl: z.string().nullable().openapi({
      description: "Public preview URL for generated DESIGN.md",
      example: "https://www.masumi.network/tools/design-md?cached=42",
    }),
    url: z.string().nullable().openapi({
      description: "Persisted DESIGN.md blob URL",
      example: "https://blob.example/design-md/file.md",
    }),
  })
  .nullable()
  .openapi("DesignMdMetadata");

export const designMdUpdateRequestSchema = z
  .object({
    extractionId: z.string().nullable().optional(),
    url: z.httpUrl().nullable(),
  })
  .refine((data) => data.url !== undefined || data.extractionId !== undefined, {
    message: "At least one of url or extractionId must be provided",
  })
  .openapi("DesignMdUpdateRequest");
