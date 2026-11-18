import { z } from "@hono/zod-openapi";
import { TagColor } from "@sokosumi/database";

export const tagColorSchema = z.enum(TagColor).openapi("TagColor");

export const workspaceTagColorFields = {
  color: tagColorSchema.nullish(),
  customColor: z
    .string()
    .length(7)
    .regex(/^#[0-9a-fA-F]{6}$/)
    .toUpperCase()
    .nullish()
    .openapi({
      description:
        "Exact six-digit hex color for the tag. Overrides its named color when present.",
      example: "#127DA2",
    }),
};
