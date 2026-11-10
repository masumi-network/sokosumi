import { z } from "zod";

/** Tab order: the agent first, then its approvals, then the three tools. Actions stays in view on a phone. */
export const SEO_TABS = [
  "agent",
  "actions",
  "traffic",
  "rankings",
  "health",
] as const;
export type SeoTab = (typeof SEO_TABS)[number];

/** Links saved before the agent layout keep opening the tab that now holds their content. */
const LEGACY_SEO_TABS = new Map<string, SeoTab>([
  ["overview", "agent"],
  ["keywords", "rankings"],
  ["competitors", "rankings"],
  ["pages", "health"],
]);

export function seoTab(value: string | null | undefined): SeoTab | null {
  if (!value) return null;
  return (SEO_TABS as readonly string[]).includes(value)
    ? (value as SeoTab)
    : (LEGACY_SEO_TABS.get(value) ?? null);
}

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

export const seoPageQuerySchema = seoFilterQuerySchema.safeExtend({
  auditId: z.uuid().optional(),
  // The header's Project scope. It sits beside an open Audit: the page moves a mismatch to the Audit's Project.
  projectId: z.uuid().optional(),
  cursor: z.string().max(200).optional(),
  tab: z
    .string()
    .refine((value) => seoTab(value) !== null, "Unknown tab")
    .optional(),
});

/** Invalid URL filters must not fall back to a broader page selection. */
export function readSeoPageQuery(
  input: Record<string, string | string[] | undefined>,
) {
  return seoPageQuerySchema.safeParse(input);
}
