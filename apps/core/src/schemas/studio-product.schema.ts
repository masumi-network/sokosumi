import { z } from "@hono/zod-openapi";
import { isValidHttpUrl } from "@sokosumi/utils";

export const MAX_STUDIO_PRODUCTS = 20;
export const STUDIO_PRODUCT_NAME_LIMIT = 160;
export const STUDIO_PRODUCT_DESCRIPTION_LIMIT = 800;
export const STUDIO_PRODUCT_PRICE_LIMIT = 80;

const publicWebsite = z
  .string()
  .max(2_048)
  .refine((value) => {
    const url = URL.parse(value);
    return url && !url.username && !url.password && isValidHttpUrl(value);
  }, "Enter a public website URL.");

export const studioProductSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(STUDIO_PRODUCT_NAME_LIMIT),
    description: z.string().trim().max(STUDIO_PRODUCT_DESCRIPTION_LIMIT),
    price: z.string().trim().max(STUDIO_PRODUCT_PRICE_LIMIT),
    url: publicWebsite.nullable(),
    imageUrl: publicWebsite.nullable(),
  })
  .openapi("StudioProduct");

const productsSchema = z.array(studioProductSchema).max(MAX_STUDIO_PRODUCTS);

export const studioProductCatalogSchema = z
  .object({
    products: productsSchema.refine(
      (products) =>
        new Set(products.map(({ id }) => id)).size === products.length,
      "Product ids must be unique.",
    ),
    revision: z.number().int().nonnegative(),
  })
  .openapi("StudioProductCatalog");

export const studioProductImportRequestSchema = z.object({
  url: publicWebsite,
});
export const studioProductImportSchema = z
  .object({ products: productsSchema })
  .openapi("StudioProductImport");

export type StudioProduct = z.infer<typeof studioProductSchema>;

export const studioProductPhotoRequestSchema = studioProductSchema
  .pick({ name: true })
  .extend({ imageUrl: publicWebsite });

export const studioProductPhotoSchema = studioProductSchema
  .pick({ id: true, name: true })
  .openapi("StudioProductPhoto");
