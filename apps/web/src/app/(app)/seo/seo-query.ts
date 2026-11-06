import { z } from "zod";

export const SEO_TABS = [
  "overview",
  "keywords",
  "competitors",
  "pages",
  "actions",
] as const;
export type SeoTab = (typeof SEO_TABS)[number];

export const seoFilterQuerySchema = z
  .object({
    scopeId: z.uuid().optional(),
    pageId: z.uuid().optional(),
    // Web uses saved groups for multiple pages. Never drop Core explicit-page filters.
    pageIds: z.never().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    channel: z.enum(["all", "organic"]).optional(),
  })
  .refine(
    (query) => !(query.pageId && query.scopeId),
    "Choose a page or a group",
  )
  .refine(
    (query) => !query.from || !query.to || query.from <= query.to,
    "Invalid period",
  );

export const seoPageQuerySchema = seoFilterQuerySchema
  .safeExtend({
    auditId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    cursor: z.string().max(200).optional(),
    tab: z.enum(SEO_TABS).optional(),
  })
  .refine(
    (query) => !(query.auditId && query.projectId),
    "Choose one SEO audit",
  );

/** Invalid URL filters must not fall back to a broader page selection. */
export function readSeoPageQuery(
  input: Record<string, string | string[] | undefined>,
) {
  return seoPageQuerySchema.safeParse(input);
}
