import { z } from "@hono/zod-openapi";

export const siteIconQuerySchema = z
  .object({
    url: z
      .string()
      .min(1)
      .max(2048)
      .openapi({
        param: { name: "url", in: "query" },
        description: "Website URL to scrape a high-quality icon from.",
        example: "https://example.com",
      }),
    organizationId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .openapi({
        param: { name: "organizationId", in: "query" },
        description:
          "Organization that will own the logo under organizations/{id}/logos/.",
        example: "org_123",
      }),
    projectId: z
      .string()
      .uuid()
      .optional()
      .openapi({
        param: { name: "projectId", in: "query" },
        description:
          "Project that will own the logo under projects/{id}/logos/.",
        example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      }),
  })
  .superRefine((data, ctx) => {
    if (Boolean(data.organizationId) === Boolean(data.projectId)) {
      ctx.addIssue({
        code: "custom",
        message: "Provide exactly one of organizationId or projectId",
        path: [],
      });
    }
  });

export const siteIconResponseSchema = z
  .object({
    /** Public blob URL of the stored icon, or null when none was found. */
    url: z.string().url().nullable(),
  })
  .openapi("SiteIconResult");
