import { z } from "@hono/zod-openapi";
import {
  seoDeviceSchema,
  seoEditorialKeywordSchema,
  seoIdeaRankSchema,
  seoSeveritySchema,
  seoUrlSchema,
} from "@/schemas/project-seo.schema";
import { seoBodyDraftSchema } from "@/schemas/project-seo-action.schema";
import { difficulty, storedEstimate } from "./project-seo-report-keywords";

/** The stored rows of an SEO report: findings, keywords, competitors and actions. */
export const text = z.string().max(20_000);
export const nullableNumber = z.number().finite().nullable();
export const observedAt = z.string().datetime();
const source = z.object({ sourceRef: text, observedAt });
export const finding = source.extend({
  id: text,
  pageUrl: seoUrlSchema,
  device: seoDeviceSchema.nullable(),
  rowId: text,
  title: text,
  severity: seoSeveritySchema,
  evidence: z.array(text).max(100),
});
export const keyword = source.extend({
  keyword: text,
  pageUrl: seoUrlSchema,
  device: seoDeviceSchema.nullable(),
  position: nullableNumber,
  positionStatus: z.enum(["ranked", "not_in_range", "unavailable"]),
  checkedResults: z.number().int().nullable(),
  volume: nullableNumber.optional(),
  difficulty,
  intent: text.nullable().optional(),
  editorial: seoEditorialKeywordSchema.optional(),
  ideaRank: seoIdeaRankSchema,
  ...storedEstimate,
  source: text.optional(),
});
export const competitor = source.extend({
  pageUrl: seoUrlSchema,
  scopePageUrls: z.array(seoUrlSchema).max(10).optional(),
  role: z.enum(["page", "competitor"]),
  backlinks: nullableNumber,
  referringDomains: nullableNumber,
  rank: nullableNumber.optional(),
  source: text.optional(),
});
export const action = z.object({
  id: text,
  pageUrl: seoUrlSchema,
  findingIds: z.array(text),
  title: text,
  why: text,
  effort: z.enum(["low", "medium", "high"]),
  expectedEffect: text,
  edit: z
    .object({ target: text, before: text.nullable(), after: text })
    .nullable(),
  // Focused results and stored payloads read actions here: a draft Core cannot read is dropped, not the result.
  bodyDraft: seoBodyDraftSchema.optional().catch(undefined),
});
