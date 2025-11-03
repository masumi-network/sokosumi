import * as z from "zod";

export const categoryGradientStopSchema = z.object({
  color: z.string(),
  offset: z.number().min(0).max(1),
  opacity: z.number().min(0).max(1).optional(),
});

export const categoryGradientSchema = z.object({
  type: z.string(),
  angle: z.number().optional(),
  shape: z.string().optional(),
  extent: z.string().optional(),
  position: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  stops: z.array(categoryGradientStopSchema).min(1),
});

export const categoryStyleThemeSchema = z.object({
  color: z.string().optional(),
  border: z
    .object({
      gradient: categoryGradientSchema,
    })
    .optional(),
});

export const categoryStylesSchema = z.object({
  light: categoryStyleThemeSchema.optional(),
  dark: categoryStyleThemeSchema.optional(),
});

export type CategoryStylesSchemaType = z.infer<typeof categoryStylesSchema>;
