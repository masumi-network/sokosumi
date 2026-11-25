import { z } from "@hono/zod-openapi";
import {
  seoDeviceSchema,
  seoEditorialKeywordSchema,
  seoSeveritySchema,
} from "@/schemas/project-seo.schema";
import { seoAuditFinalUrls, seoUrlSchema } from "@/schemas/seo-page.schema";
import { difficulty, estimate } from "./project-seo-report-keywords";

const text = z.string().max(20_000);
const nullableNumber = z.number().finite().nullable();
const observedAt = z.string().datetime();
// Two seasonal reviewers can each propose five searches. History can supply three further terms.
const MAX_SEASONAL_IDEAS = 13;
export const legacySeoReportSchema = z.object({
  seasonalReview: z
    .object({ insights: z.array(z.unknown()).max(MAX_SEASONAL_IDEAS) })
    .optional()
    .catch(undefined),
  request: z.object({ url: seoUrlSchema }),
  snapshotId: text,
  rulebookVersion: text,
  header: z.object({
    capturedAt: observedAt,
    finalUrl: seoAuditFinalUrls,
    market: z.object({ country: text, language: text }).nullable(),
    focusKeywords: z
      .array(
        z.object({
          keyword: text,
          volume: nullableNumber,
          intent: text.nullable(),
          position: z.object({
            mobile: nullableNumber,
            desktop: nullableNumber,
          }),
          positionNote: z.object({
            mobile: text.nullable(),
            desktop: text.nullable(),
          }),
          ...estimate,
        }),
      )
      .max(500),
  }),
  findings: z
    .array(
      z.object({
        id: text,
        row: text,
        name: text,
        level: seoSeveritySchema,
        devices: z.array(seoDeviceSchema),
        evidence: z.array(text),
      }),
    )
    .max(5000),
  actions: z
    .array(
      z.object({
        n: z.number().int(),
        title: text,
        why: text,
        effort: z.enum(["low", "medium", "high"]),
        whatToExpect: text,
        findings: z.array(text),
        edit: z
          .object({ target: text, before: text.optional(), after: text })
          .optional(),
      }),
    )
    .max(100),
  rankingData: z
    .object({
      competitors: z.array(
        z
          .object({
            url: seoUrlSchema,
            source: text,
            rank: nullableNumber,
            referringDomains: nullableNumber.optional(),
          })
          .passthrough(),
      ),
      page: z
        .object({
          ranked: z
            .object({
              rows: z.array(
                z.object({
                  keyword: text.nullable(),
                  position: nullableNumber,
                  volume: nullableNumber,
                  difficulty,
                  intent: text.nullable(),
                }),
              ),
            })
            .passthrough()
            .nullable(),
          summary: z
            .object({
              backlinks: nullableNumber,
              referring_domains: nullableNumber,
            })
            .passthrough()
            .nullable(),
          referringDomains: nullableNumber,
        })
        .passthrough()
        .optional(),
      gaps: z
        .array(z.object({ keyword: text, bestVolume: nullableNumber }))
        .nullable()
        .optional(),
    })
    .passthrough()
    .nullable(),
  // The Target keyword's own facts: its difficulty when no ranked or idea row holds the keyword.
  keywordData: z
    .object({
      facts: z.object({
        keyword: text.nullable(),
        keyword_difficulty: difficulty,
      }),
    })
    .nullable()
    .optional()
    .catch(null),
  keywordOpportunities: z
    .object({
      editorialResearch: z
        .object({
          status: z.enum(["complete", "partial", "skipped"]),
          proposed: z.number().int().nonnegative(),
          checked: z.number().int().nonnegative(),
          qualified: z.number().int().nonnegative(),
        })
        .optional()
        .catch(undefined),
      list: z.array(
        z.object({
          keyword: text,
          volume: z.number().finite(),
          difficulty,
          position: nullableNumber,
          intent: text.nullable(),
          editorial: seoEditorialKeywordSchema.optional().catch(undefined),
          ...estimate,
        }),
      ),
    })
    .passthrough()
    .nullable()
    .optional(),
  checklist: z
    .array(
      z.object({
        row: text,
        device: seoDeviceSchema,
        result: z.enum(["pass", "fired", "blocked", "not checked"]),
        sourceReason: z.string().optional().catch(undefined),
        detail: z.string().optional().catch(undefined),
      }),
    )
    .max(10000),
  couldNotSee: z.array(z.object({ item: text, reason: text })).max(1000),
});
/** The SEO bot's own Report JSON, as far as Core reads it. */
export type LegacySeoReport = z.infer<typeof legacySeoReportSchema>;
