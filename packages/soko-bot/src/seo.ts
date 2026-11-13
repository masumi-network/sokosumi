import { SEO_MIN_AUDIT_USD } from "@sokosumi/utils";
import { z } from "zod";

const projectId = z.string().uuid();
const id = z.string().min(1).max(128);
const pageIds = z
  .array(projectId)
  .min(1)
  .max(10)
  .refine(
    (values) => new Set(values).size === values.length,
    "Pages must be distinct",
  );
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Expected a calendar date");
const url = z
  .url({ protocol: /^https?$/ })
  .max(4096)
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const parsed = new URL(value);
    return !parsed.username && !parsed.password;
  }, "Page URLs cannot contain credentials");
const key = z.string().trim().min(8).max(128);
const market = {
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  languageCode: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
};
const scope = {
  scopeId: projectId.optional(),
  pageIds: pageIds.optional(),
  expectedScopeVersion: z.number().int().positive().optional(),
};
const SEARCH_LANGUAGES = new Set(
  "af ak am ar az be bg bn bs ca cs cy da de ee el en es et eu fa fi fo fr fy ga gl gu ha he hi hr ht hu hy id ig is it iw ja ka kg kk km kn ko ky lg ln lo lt lv mg mi mk ml mn mr ms mt my ne nl no ny om pa pl ps pt qu rm rn ro ru rw sd si sk sl sn so sq sr st sv sw ta te tg th ti tk tl tn to tr uk ur uz vi wo xh yo zu".split(
    " ",
  ),
);
const requestMarket = {
  countryCode: z.enum([
    "US",
    "GB",
    "DE",
    "AT",
    "CH",
    "FR",
    "ES",
    "IT",
    "NL",
    "BR",
    "PT",
  ]),
  languageCode: z
    .string()
    .regex(/^[a-z]{2}$/)
    .refine(
      (value) => SEARCH_LANGUAGES.has(value),
      "Unsupported search language",
    ),
};
const requestKeyword = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !/["\p{Cc}]/u.test(value), "Unsupported keyword");
const exclusiveScope = (input: { scopeId?: string; pageIds?: string[] }) =>
  !(input.scopeId && input.pageIds);
const frozenScope = (input: {
  scopeId?: string;
  expectedScopeVersion?: number;
}) =>
  input.scopeId
    ? input.expectedScopeVersion !== undefined
    : input.expectedScopeVersion === undefined;
const MAX_STATISTICS_DAYS = 366;
const DAY_MS = 86_400_000;

export const SOKO_BOT_SEO_READ_CAPABILITIES = [
  "get_seo_workspace",
  "list_seo_statistics_properties",
] as const;
export const SOKO_BOT_SEO_WRITE_CAPABILITIES = [
  "add_seo_page",
  "save_seo_scope",
  "save_seo_keyword",
  "save_seo_competitor",
  "import_seo_audit",
  "request_seo_analysis",
  "create_seo_action_task",
  "sync_seo_statistics",
  "record_seo_page_change",
] as const;
export const SOKO_BOT_SEO_CAPABILITIES = [
  ...SOKO_BOT_SEO_READ_CAPABILITIES,
  ...SOKO_BOT_SEO_WRITE_CAPABILITIES,
] as const;
export type SokoBotSeoCapability = (typeof SOKO_BOT_SEO_CAPABILITIES)[number];
export function isSokoBotSeoCapability(
  value: string,
): value is SokoBotSeoCapability {
  return (SOKO_BOT_SEO_CAPABILITIES as readonly string[]).includes(value);
}

export const SOKO_BOT_SEO_INPUT_SCHEMAS = {
  get_seo_workspace: z
    .object({
      projectId,
      scopeId: projectId.optional(),
      pageId: projectId.optional(),
      pageIds: pageIds.optional(),
      from: date.optional(),
      to: date.optional(),
      channel: z.enum(["all", "organic"]).optional(),
    })
    .strict()
    .refine(
      (input) =>
        [input.scopeId, input.pageId, input.pageIds].filter(Boolean).length <=
        1,
      "Choose a scope, a page or explicit pages",
    )
    .refine(
      (input) => !input.from || !input.to || input.from <= input.to,
      "Period ends before it starts",
    ),
  list_seo_statistics_properties: z
    .object({ projectId, provider: z.enum(["ga4", "search_console"]) })
    .strict(),
  add_seo_page: z
    .object({
      projectId,
      url,
      label: z.string().max(200).optional(),
      relationship: z.enum(["primary", "related"]).default("primary"),
      relatedToPageId: projectId.optional(),
    })
    .strict(),
  save_seo_scope: z
    .object({
      projectId,
      scopeId: projectId.optional(),
      name: z.string().trim().min(1).max(100),
      pageIds,
      expectedVersion: z.number().int().positive().optional(),
    })
    .strict()
    .refine(
      (input) => !input.scopeId || input.expectedVersion !== undefined,
      "Updating a scope requires its last-read expectedVersion",
    ),
  save_seo_keyword: z
    .object({
      projectId,
      keyword: z.string().trim().min(1).max(200),
      ...market,
      pageId: projectId.nullable().optional(),
      priority: z.enum(["low", "medium", "high"]).default("medium"),
      saved: z.boolean().default(true),
      expectedVersion: z.number().int().positive().optional(),
    })
    .strict(),
  save_seo_competitor: z
    .object({
      projectId,
      url,
      confirmed: z.boolean(),
      expectedVersion: z.number().int().positive().optional(),
    })
    .strict(),
  import_seo_audit: z.object({ projectId, taskId: id, fileId: id }).strict(),
  request_seo_analysis: z
    .object({
      projectId,
      kind: z.enum([
        "page_check",
        "rankings",
        "links",
        "audit_lite",
        "audit_full",
      ]),
      ...scope,
      ...requestMarket,
      keywords: z.array(requestKeyword).max(20).default([]),
      devices: z
        .array(z.enum(["mobile", "desktop"]))
        .min(1)
        .max(2)
        .default(["mobile", "desktop"]),
      competitorUrls: z.array(url).max(10).default([]),
      analyses: z
        .array(z.enum(["page.inspect", "keyword.refresh", "links.refresh"]))
        .min(1)
        .max(3)
        .optional(),
      maxProviderCalls: z.number().int().min(0).max(100).default(20),
      fullAuditLimits: z
        .object({
          usd: z.number().min(SEO_MIN_AUDIT_USD).max(50),
          seconds: z.number().int().min(60).max(3600),
        })
        .strict()
        .optional(),
      idempotencyKey: key,
      coworkerId: id.optional(),
    })
    .strict()
    .refine(exclusiveScope, "Choose pages or a saved scope")
    .refine(
      frozenScope,
      "A saved scope requires its last-read expectedScopeVersion",
    ),
  create_seo_action_task: z
    .object({
      projectId,
      observationId: projectId,
      actionId: z.string().min(1).max(200),
      idempotencyKey: key,
    })
    .strict(),
  record_seo_page_change: z
    .object({
      projectId,
      pageIds,
      occurredAt: z.iso.datetime({ offset: true }),
      title: z.string().trim().min(1).max(200),
      note: z.string().max(2000).default(""),
      idempotencyKey: key,
    })
    .strict(),
  sync_seo_statistics: z
    .object({
      projectId,
      provider: z.enum(["ga4", "search_console"]),
      propertyId: z.string().trim().min(1).max(500),
      ...scope,
      from: date,
      to: date,
      channel: z.enum(["all", "organic"]).default("all"),
    })
    .strict()
    .refine(exclusiveScope, "Choose pages or a saved scope")
    .refine(
      frozenScope,
      "A saved scope requires its last-read expectedScopeVersion",
    )
    .refine(
      (input) =>
        input.from <= input.to &&
        Date.parse(input.to) - Date.parse(input.from) <
          MAX_STATISTICS_DAYS * DAY_MS,
      "Choose a period of at most one year",
    ),
} as const;

export const SOKO_BOT_SEO_DESCRIPTIONS = {
  get_seo_workspace:
    "Read SEO pages, page groups, keywords, competitors, evidence, recommendations and timeline for the selected Sokosumi project. Call related-page collections page groups, and analysis runs or reports audits. Source dates and coverage remain explicit. Private Google statistics appear only in the owner's private personal Soko Bot context. This does not refresh any data or spend provider usage.",
  list_seo_statistics_properties:
    "List Analytics or Search Console properties available through this owner's personal Soko Bot native connection. This does not create a connection. Use the returned property ID; never guess it.",
  add_seo_page:
    "Save a public SEO page under the selected Sokosumi project, optionally as a related page. Related pages can be organized into a page group. Saving does not audit the page or spend provider usage. Use a real related page ID from get_seo_workspace.",
  save_seo_scope:
    "Create or update an SEO page group: a named collection of related pages within the selected Sokosumi project. When updating, pass the page group's last-read expectedVersion. Membership changes affect future requests only; historical observations retain their frozen scope.",
  save_seo_keyword:
    "Save, un-save or prioritize one keyword in its Market, optionally with a target page. This is the owner's choice, separate from observed ranking data. A keyword with saved true and version 0 is tracked from a check and the owner did not choose it: never add it to a paid analysis unless the owner names it. Omit expectedVersion when the last-read version is 0; reuse the last-read expectedVersion when editing a stored choice.",
  save_seo_competitor:
    "Confirm or dismiss a suggested Competitor, preserving its source evidence. A search result is a candidate, not automatically a business competitor. Do not confirm unresolved redirect URLs. Reuse the last-read expectedVersion when editing.",
  import_seo_audit:
    "Index a ready SEO JSON report from an accessible completed Coworker Task. Use actual Task and file IDs. Core verifies the uploader, source and public schema. Never send an arbitrary report URL, Google evidence or credentials.",
  request_seo_analysis:
    "Request the public SEO Coworker to check explicitly selected pages and Analyses. page_check is raw deterministic inspection; rankings and links may incur provider usage. audit_lite selects a bounded subset before execution. Confirm scope, Market, devices and call allowance with the owner. Reuse the same idempotencyKey on retries. Never include private analytics or credentials.",
  create_seo_action_task:
    "Turn a stored public SEO recommendation into an evidence-linked Task. Use its observationId and actionId from get_seo_workspace. Reuse the idempotencyKey on retries. Task completion means implemented; verification requires a compatible Recheck.",
  sync_seo_statistics:
    "Read measured page views, users and scoped sessions, or Search Console performance, through the owner's existing personal Soko Bot connection. Use a property returned by list_seo_statistics_properties. Dates and page scope are explicit. Google data stays private and never enters the external SEO Coworker's Task.",
  record_seo_page_change:
    "Record the owner's reported change on selected SEO pages with its actual date and evidence note. This adds a manual timeline entry. It does not verify implementation, attribution or SEO improvement. Reuse the idempotencyKey on retries.",
} as const;
