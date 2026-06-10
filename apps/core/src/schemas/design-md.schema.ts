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
