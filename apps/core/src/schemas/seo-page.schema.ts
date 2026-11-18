import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";

export const SEO_MAX_PAGES = 10;
export const seoIdSchema = z.string().uuid();
export const seoUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(4096)
  .refine((value) => {
    // A value that is no address already failed the check above; `new URL` would throw on it.
    if (!URL.canParse(value)) return true;
    const url = new URL(value);
    return !url.username && !url.password;
  }, "Page URLs cannot contain credentials");
export const seoBriefAction = z.enum([
  "sign up",
  "buy",
  "contact sales",
  "book",
  "subscribe",
  "download",
  "call",
  "visit",
  "read",
  "none",
]);

export const seoPageSchema = z
  .object({
    id: seoIdSchema,
    url: seoUrlSchema,
    label: z.string(),
    relationship: z.enum(["primary", "related"]),
    relatedToPageId: z.union([seoIdSchema, z.null()]),
    createdAt: dateTimeSchema,
  })
  .openapi("ProjectSeoPage");
export const seoScopeSchema = z
  .object({
    id: seoIdSchema,
    name: z.string(),
    pageIds: z.array(seoIdSchema),
    version: z.number().int().positive(),
  })
  .openapi("ProjectSeoScope");

export const addSeoPageSchema = z
  .object({
    url: seoUrlSchema,
    label: z.string().trim().max(200).optional(),
    relationship: z.enum(["primary", "related"]).default("primary"),
    relatedToPageId: seoIdSchema.optional(),
  })
  .strict()
  .openapi("AddProjectSeoPageRequest");
export const createSeoScopeSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    pageIds: z.array(seoIdSchema).min(1).max(SEO_MAX_PAGES),
  })
  .strict()
  .openapi("CreateProjectSeoScopeRequest");
export const updateSeoScopeSchema = createSeoScopeSchema
  .extend({ expectedVersion: z.number().int().positive() })
  .openapi("UpdateProjectSeoScopeRequest");
