import { z } from "@hono/zod-openapi";

import { LIMITS } from "@/config/constants";

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
 * `content` is the DESIGN.md markdown to store — Core uploads it to blob storage
 * and owns the resulting URL — or `null` to clear the DESIGN.md.
 * `extractionId` is the generation/extraction id when known, or `null` (e.g. a
 * manual upload or a clear).
 */
export const designMdWriteSchema = z
  .object({
    content: z
      .string()
      .refine((value) => value.trim().length > 0, "DESIGN.md must not be empty")
      .refine(
        (value) =>
          Buffer.byteLength(value, "utf8") <= LIMITS.DESIGN_MD_MAX_SIZE_BYTES,
        `DESIGN.md exceeds the maximum size of ${LIMITS.DESIGN_MD_MAX_SIZE_BYTES} bytes`,
      )
      .nullable()
      .openapi({
        example: "# DESIGN.md\n\nBrand guidelines…",
        description: "DESIGN.md markdown to store, or null to clear it",
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
