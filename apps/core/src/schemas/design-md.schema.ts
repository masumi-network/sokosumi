import { z } from "@hono/zod-openapi";

/**
 * The DESIGN.md attachment that is currently in effect for a user.
 *
 * Resolution prefers the active organization's DESIGN.md (when the user is a
 * member and the organization has one) over the user's own. `designMd` is
 * `null` when neither the organization nor the user has a DESIGN.md configured.
 */
export const effectiveDesignMdSchema = z
  .object({
    designMd: z
      .object({
        label: z
          .string()
          .openapi({ example: "DESIGN.md", description: "Attachment label" }),
        url: z.string().openapi({
          example: "https://blob.example/design.md",
          description: "Public blob URL of the DESIGN.md attachment",
        }),
      })
      .nullable()
      .openapi({ description: "The effective DESIGN.md, or null when none" }),
  })
  .openapi("EffectiveDesignMd");

export type EffectiveDesignMd = z.infer<typeof effectiveDesignMdSchema>;

/**
 * Request body for setting (or clearing) a user's or organization's DESIGN.md.
 *
 * `url` is the public blob URL to store, or `null` to clear the DESIGN.md.
 * `extractionId` is the generation/extraction id when known, or `null` (e.g. a
 * manual upload or a clear).
 */
export const designMdWriteSchema = z
  .object({
    url: z.string().nullable().openapi({
      example: "https://blob.example/design.md",
      description: "Public blob URL of the DESIGN.md, or null to clear it",
    }),
    extractionId: z.string().nullable().openapi({
      example: "12345",
      description: "Extraction id of the generated DESIGN.md, when known",
    }),
  })
  .openapi("DesignMdWrite");

export type DesignMdWrite = z.infer<typeof designMdWriteSchema>;

/**
 * Result of persisting a DESIGN.md: the normalized stored values, or `null`
 * when the DESIGN.md was cleared (no URL remains).
 */
export const persistedDesignMdSchema = z
  .object({
    designMd: z
      .object({
        url: z.string().openapi({
          example: "https://blob.example/design.md",
          description: "Public blob URL of the stored DESIGN.md",
        }),
        extractionId: z.string().nullable().openapi({
          example: "12345",
          description: "Extraction id of the stored DESIGN.md, when known",
        }),
      })
      .nullable()
      .openapi({
        description: "The persisted DESIGN.md, or null when cleared",
      }),
  })
  .openapi("PersistedDesignMd");

export type PersistedDesignMd = z.infer<typeof persistedDesignMdSchema>;
