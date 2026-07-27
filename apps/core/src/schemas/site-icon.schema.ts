import { z } from "@hono/zod-openapi";

export const siteIconQuerySchema = z.object({
  url: z
    .string()
    .min(1)
    .max(2048)
    .openapi({
      param: { name: "url", in: "query" },
      description: "Website URL to scrape a high-quality icon from.",
      example: "https://example.com",
    }),
});

export const siteIconResponseSchema = z
  .object({
    /** Public blob URL of the stored icon, or null when none was found. */
    url: z.string().url().nullable(),
  })
  .openapi("SiteIconResult");
