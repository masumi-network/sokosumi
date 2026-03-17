import { z } from "@hono/zod-openapi";
import type { Category as DatabaseCategory } from "@sokosumi/database";

const gradientStopSchema = z.object({
  color: z.string().openapi({ example: "text-default-foreground" }),
  offset: z.number().min(0).max(1).openapi({ example: 0.5 }),
  opacity: z.number().min(0).max(1).optional().openapi({ example: 0.8 }),
});

const gradientSchema = z.object({
  type: z.string().openapi({ example: "linear" }),
  angle: z.number().optional().openapi({ example: 135 }),
  shape: z.string().optional().openapi({ example: "ellipse" }),
  extent: z.string().optional().openapi({ example: "farthest-corner" }),
  position: z
    .object({
      x: z.number().openapi({ example: 0.5 }),
      y: z.number().openapi({ example: 0.5 }),
    })
    .optional(),
  stops: z.array(gradientStopSchema).min(1),
});

const styleThemeSchema = z.object({
  color: z.string().optional().openapi({ example: "text-default-foreground" }),
  border: z
    .object({
      gradient: gradientSchema,
    })
    .optional(),
});

export const categoryStylesSchema = z
  .object({
    light: styleThemeSchema.optional(),
    dark: styleThemeSchema.optional(),
  })
  .openapi("CategoryStyles");

export type CategoryStyles = z.infer<typeof categoryStylesSchema>;

export function parseCategoryStyles(
  raw: string | null | undefined,
): CategoryStyles | null {
  if (!raw?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const result = categoryStylesSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export const categorySchema = z
  .object({
    id: z.string().openapi({ example: "cat_123" }),
    name: z.string().openapi({ example: "Research" }),
    slug: z.string().openapi({ example: "research" }),
    description: z
      .string()
      .nullable()
      .openapi({ example: "Agents for research tasks" }),
    image: z
      .string()
      .nullable()
      .openapi({ example: "https://example.com/cat.png" }),
    icon: z
      .string()
      .nullable()
      .openapi({ example: "https://example.com/cat.svg" }),
    priority: z.number().openapi({ example: 0 }),
    styles: categoryStylesSchema.nullable().openapi({
      description: "Optional category-specific UI styles.",
      example: {
        light: {
          color: "text-default-foreground",
        },
      },
    }),
  })
  .openapi("Category");

export type Category = z.infer<typeof categorySchema>;

export function mapCategoryForApi(category: DatabaseCategory): Category {
  return categorySchema.parse({
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    image: category.image,
    icon: category.icon,
    priority: category.priority,
    styles: parseCategoryStyles(category.styles),
  });
}
