import { z } from "@hono/zod-openapi";

import { badRequest } from "@/helpers/error";
import {
  seoConversionSchema,
  seoDeviceSchema,
  seoModuleCoverageSchema,
  seoSeveritySchema,
  seoUrlSchema,
} from "@/schemas/project-seo.schema";
import { seoStrategyPayloadSchema } from "@/schemas/project-seo-strategy.schema";
import { assertValidPartialSeoActions } from "./project-seo-partial-actions";
import { legacyReportKeywords } from "./project-seo-report-keywords";
import {
  focusedSerpFields,
  seoAlertRowsSchema,
  seoSerpReadsSchema,
} from "./project-seo-report-serps";
import { publicSiteFindings } from "./project-seo-site-findings";
import { publicSeoStrategy } from "./project-seo-strategy";

const text = z.string().max(20_000);
const nullableNumber = z.number().finite().nullable();
const observedAt = z.string().datetime();
const source = z.object({ sourceRef: text, observedAt });
const FEATURE_CHARS = 200;
// DataForSEO keyword_difficulty: 0 to 100. A value Core cannot read is dropped: it must not fail the import.
const difficulty = z
  .number()
  .finite()
  .min(0)
  .max(100)
  .nullable()
  .optional()
  .catch(undefined);
const finding = source.extend({
  id: text,
  pageUrl: seoUrlSchema,
  device: seoDeviceSchema.nullable(),
  rowId: text,
  title: text,
  severity: seoSeveritySchema,
  evidence: z.array(text).max(100),
});
const keyword = source.extend({
  keyword: text,
  pageUrl: seoUrlSchema,
  device: seoDeviceSchema.nullable(),
  position: nullableNumber,
  positionStatus: z.enum(["ranked", "not_in_range", "unavailable"]),
  checkedResults: z.number().int().nullable(),
  volume: nullableNumber.optional(),
  difficulty,
  intent: text.nullable().optional(),
  conversion: seoConversionSchema.nullable().optional(),
  feature: z.string().max(FEATURE_CHARS).nullable().optional(),
  source: text.optional(),
});
const competitor = source.extend({
  pageUrl: seoUrlSchema,
  scopePageUrls: z.array(seoUrlSchema).max(10).optional(),
  role: z.enum(["page", "competitor"]),
  backlinks: nullableNumber,
  referringDomains: nullableNumber,
  rank: nullableNumber.optional(),
  source: text.optional(),
});
const action = z.object({
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
});
export const publicSeoPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.string().max(100),
  requestId: z.string().uuid().nullable(),
  pageUrls: z.array(seoUrlSchema).min(1).max(10),
  observedAt,
  countryCode: z.string().max(10),
  languageCode: z.string().max(20),
  rulebookVersion: text,
  checks: z
    .array(
      z.object({
        rowId: text,
        pageUrl: seoUrlSchema,
        device: seoDeviceSchema,
        result: z.enum(["pass", "fired", "blocked", "not_checked"]),
      }),
    )
    .max(10000),
  keywords: z.array(keyword).max(5000),
  competitors: z.array(competitor).max(1000),
  findings: z.array(finding).max(5000),
  actions: z.array(action).max(100),
  coverage: z.object({
    checked: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    modules: seoModuleCoverageSchema.optional(),
  }),
  notes: z.array(text).max(500),
  /** A site audit's strategy results. Older rows and focused checks have none. */
  strategy: seoStrategyPayloadSchema.optional(),
  /** A focused result's SERP reads per keyword and device. Older results and audits have none. */
  serps: seoSerpReadsSchema.optional(),
  /** Monitor rule ids that fired in a focused result's Run. */
  alertRows: seoAlertRowsSchema.optional(),
});
export type PublicSeoPayload = z.infer<typeof publicSeoPayloadSchema>;

function focusedRuleCoverage(
  checks: PublicSeoPayload["checks"],
  modules: NonNullable<PublicSeoPayload["coverage"]["modules"]>,
): PublicSeoPayload["coverage"] {
  return {
    checked: checks.filter(
      (check) => check.result === "pass" || check.result === "fired",
    ).length,
    skipped: checks.filter((check) => check.result === "not_checked").length,
    failed: checks.filter((check) => check.result === "blocked").length,
    modules,
  };
}

/** Older focused payloads stored module counts in the rule coverage fields. */
export function seoPayloadCoverage(
  payload: PublicSeoPayload,
): PublicSeoPayload["coverage"] {
  if (payload.kind === "audit_full") return payload.coverage;
  return focusedRuleCoverage(
    payload.checks,
    payload.coverage.modules ?? {
      notRequested: payload.coverage.skipped,
      failed: payload.coverage.failed,
    },
  );
}

const frozenRequest = z.object({
  pageUrls: z.array(seoUrlSchema).min(1),
  countryCode: text,
  languageCode: text,
  keywords: z.array(text).optional(),
  devices: z.array(seoDeviceSchema).optional(),
  competitorUrls: z.array(seoUrlSchema).optional(),
});
const sameSet = (a: string[], b: string[]) =>
  a.length === new Set(a).size &&
  a.length === b.length &&
  a.every((value) => b.includes(value));
const normalizedUrl = (value: string) => {
  const url = new URL(value);
  url.hash = "";
  return url.href;
};

// A site audit keeps going when one page Run fails. The worker names that page in `selection.skipped`.
const siteSkipped = z.object({
  selection: z.object({
    skipped: z
      .array(z.object({ url: seoUrlSchema, reason: z.string() }))
      .max(10),
  }),
});
const skippedPages = (raw: unknown) => {
  if (object(raw)?.kind !== "site") return [];
  const parsed = siteSkipped.safeParse(raw);
  return parsed.success ? parsed.data.selection.skipped : [];
};
const SKIPPED_REASON_CHARS = 300;

/** Bind evidence to the durable request, including Market, devices and approved external targets. */
export function assertSeoArtifactMatchesRequest(
  raw: unknown,
  payload: PublicSeoPayload,
  expected: { id: string; kind: string; request: unknown },
): void {
  const parsed = frozenRequest.safeParse(expected.request);
  if (!parsed.success)
    throw badRequest("The frozen SEO request is not readable");
  const request = parsed.data,
    pageUrls = request.pageUrls.map(normalizedUrl),
    reported = payload.pageUrls.map(normalizedUrl),
    skipped = skippedPages(raw).map((page) => normalizedUrl(page.url));
  // Every reported page is in scope, and every page in scope is reported or named as skipped, never both.
  if (
    payload.kind !== expected.kind ||
    new Set(reported).size !== reported.length ||
    reported.some((url) => !pageUrls.includes(url)) ||
    pageUrls.some((url) => !reported.includes(url) && !skipped.includes(url)) ||
    skipped.some((url) => !pageUrls.includes(url) || reported.includes(url)) ||
    payload.countryCode !== request.countryCode ||
    payload.languageCode !== request.languageCode
  )
    throw badRequest(
      "The report does not match its frozen page scope or Market",
    );
  if (
    payload.checks.some(
      (row) => !pageUrls.includes(normalizedUrl(row.pageUrl)),
    ) ||
    payload.findings.some(
      (row) => !pageUrls.includes(normalizedUrl(row.pageUrl)),
    ) ||
    payload.actions.some(
      (row) => !pageUrls.includes(normalizedUrl(row.pageUrl)),
    ) ||
    payload.keywords.some(
      (row) => !pageUrls.includes(normalizedUrl(row.pageUrl)),
    )
  )
    throw badRequest(
      "The report contains evidence outside its frozen page scope",
    );
  if (expected.kind === "audit_full") return;
  const result = partial.safeParse(raw);
  if (
    !result.success ||
    payload.requestId !== expected.id ||
    !sameSet(result.data.scope.keywords, request.keywords ?? []) ||
    !sameSet(result.data.scope.devices, request.devices ?? [])
  )
    throw badRequest(
      "The result does not match its frozen keywords or devices",
    );
  if (
    payload.keywords.some(
      (row) =>
        !request.keywords?.includes(row.keyword) ||
        (row.device && !request.devices?.includes(row.device)),
    ) ||
    payload.serps?.some(
      (row) =>
        !request.keywords?.includes(row.keyword) ||
        !request.devices?.includes(row.device),
    ) ||
    payload.checks.some((row) => !request.devices?.includes(row.device)) ||
    payload.findings.some(
      (row) => row.device && !request.devices?.includes(row.device),
    )
  )
    throw badRequest("The result contains unrequested keywords or devices");
  const competitors = request.competitorUrls?.map(normalizedUrl) ?? [];
  if (
    payload.competitors.some(
      (row) =>
        !(row.role === "page" ? pageUrls : competitors).includes(
          normalizedUrl(row.pageUrl),
        ),
    )
  )
    throw badRequest("The result contains an unapproved link target");
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const PRIVATE_FIELDS = [
  "searchConsole",
  "searchConsoleNear",
  "outcomes",
  "outcomeEvidence",
  "outcomeReading",
  "searchOutcomes",
  "businessOutcome",
  "pageComparison",
];
function refusePrivateReport(raw: unknown): void {
  const input = object(raw);
  const request = object(input?.request);
  if (
    !input ||
    PRIVATE_FIELDS.some((key) => input[key] !== undefined) ||
    (request &&
      (["outcomeSnapshot", "outcomeImport", "outcomes", "outcome"].some(
        (key) => request[key] !== undefined,
      ) ||
        (Array.isArray(request.connections) && request.connections.length > 0)))
  )
    throw badRequest("Only public SEO evidence can be imported");
  const header = object(input.header);
  if (
    Array.isArray(header?.focusKeywords) &&
    header.focusKeywords.some((row) => {
      const item = object(row);
      return (
        item &&
        ["searchConsole", "searchConsoleNote", "primary"].some(
          (key) => item[key] !== undefined,
        )
      );
    })
  )
    throw badRequest("Private search evidence cannot be imported");
  if (Array.isArray(input.pages))
    input.pages.forEach((page) =>
      refusePrivateReport(object(page)?.report ?? page),
    );
}

const partial = z
  .object({
    schema: z.literal("sokosumi.seo-result/1"),
    requestId: z.string().uuid(),
    kind: z.enum(["page_check", "rankings", "links", "audit_lite"]),
    scope: z.object({
      pageUrls: z.array(seoUrlSchema).min(1).max(10),
      keywords: z.array(text).max(50),
      countryCode: text,
      languageCode: text,
      devices: z.array(seoDeviceSchema),
    }),
    observedAt,
    rulebookVersion: text,
    checks: z
      .array(
        z
          .object({
            rowId: text,
            pageUrl: seoUrlSchema,
            device: seoDeviceSchema,
            result: z.enum(["pass", "fired", "blocked", "not_checked"]),
          })
          .passthrough(),
      )
      .max(10000),
    // A focused result carries no estimate: only a page Report does. One sent all the same is not read.
    keywords: z
      .array(keyword.omit({ conversion: true, feature: true }))
      .max(5000),
    competitors: z.array(competitor).max(1000),
    findings: z.array(finding).max(5000),
    actions: z.array(action).max(100),
    coverage: z.object({
      requested: z.array(text),
      completed: z.array(text),
      failed: z.array(text),
      skipped: z.array(text),
    }),
    gaps: z.array(z.object({ reason: text }).passthrough()).max(500),
  })
  .passthrough();
// A page Report's estimate for a keyword. A value Core cannot read is dropped: it must not fail the import.
const estimate = {
  conversion: seoConversionSchema.optional().catch(undefined),
  feature: z
    .string()
    .trim()
    .min(1)
    .max(FEATURE_CHARS)
    .optional()
    .catch(undefined),
};
const legacy = z.object({
  request: z.object({ url: seoUrlSchema }),
  snapshotId: text,
  rulebookVersion: text,
  header: z.object({
    capturedAt: observedAt,
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
      list: z.array(
        z.object({
          keyword: text,
          volume: z.number().finite(),
          difficulty,
          position: nullableNumber,
          intent: text.nullable(),
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
      }),
    )
    .max(10000),
  couldNotSee: z.array(z.object({ item: text, reason: text })).max(1000),
});
/** The SEO bot's own Report JSON, as far as Core reads it. */
export type LegacySeoReport = z.infer<typeof legacy>;
const numberAt = (value: unknown, keys: string[]): number | null => {
  let current = value;
  for (const key of keys) current = object(current)?.[key];
  return typeof current === "number" && Number.isFinite(current)
    ? current
    : null;
};

/** Parse trusted artifact bytes, keeping an explicit projection rather than arbitrary report fields. */
export function parsePublicSeoArtifact(raw: unknown): PublicSeoPayload {
  refusePrivateReport(raw);
  if (object(raw)?.kind === "site") {
    const site = z
      .object({
        pages: z.array(z.unknown()).min(1).max(10),
        rulebookVersion: text,
      })
      .safeParse(raw);
    if (!site.success)
      throw badRequest("The site report does not match its supported format");
    const pages = site.data.pages.map(parsePublicSeoArtifact),
      first = pages[0],
      { strategy, note } = publicSeoStrategy(raw),
      siteFindings = publicSiteFindings(
        raw,
        pages.flatMap((page) => page.pageUrls),
        first.observedAt,
      );
    return publicSeoPayloadSchema.parse({
      ...first,
      kind: "audit_full",
      pageUrls: pages.flatMap((page) => page.pageUrls),
      checks: pages.flatMap((page) => page.checks),
      keywords: pages.flatMap((page) => page.keywords),
      competitors: pages.flatMap((page) => page.competitors),
      findings: [
        ...pages.flatMap((page, index) =>
          page.findings.map((row) => ({ ...row, id: `${index}:${row.id}` })),
        ),
        ...siteFindings.findings,
      ],
      actions: pages.flatMap((page, index) =>
        page.actions.map((row) => ({
          ...row,
          id: `${index}:${row.id}`,
          findingIds: row.findingIds.map((id) => `${index}:${id}`),
        })),
      ),
      coverage: {
        checked: pages.reduce((sum, page) => sum + page.coverage.checked, 0),
        skipped: pages.reduce((sum, page) => sum + page.coverage.skipped, 0),
        failed: pages.reduce((sum, page) => sum + page.coverage.failed, 0),
      },
      notes: [
        ...pages.flatMap((page) => page.notes),
        ...siteFindings.notes,
        ...skippedPages(raw).map(
          (page) =>
            `Page not audited: ${page.url} (${page.reason.slice(0, SKIPPED_REASON_CHARS)})`,
        ),
        ...(note ? [note] : []),
      ],
      strategy,
    });
  }
  if (object(raw)?.schema === "sokosumi.seo-result/1") {
    const parsed = partial.safeParse(raw);
    if (!parsed.success)
      throw badRequest("The SEO result does not match its supported format");
    const result = parsed.data,
      serp = focusedSerpFields(result);
    assertValidPartialSeoActions(result);
    return publicSeoPayloadSchema.parse({
      version: 1,
      kind: result.kind,
      requestId: result.requestId,
      pageUrls: result.scope.pageUrls,
      observedAt: result.observedAt,
      countryCode: result.scope.countryCode,
      languageCode: result.scope.languageCode,
      rulebookVersion: result.rulebookVersion,
      checks: result.checks,
      keywords: result.keywords,
      competitors: result.competitors.map((row) => ({
        ...row,
        scopePageUrls: result.scope.pageUrls,
      })),
      findings: result.findings,
      actions: result.actions,
      coverage: focusedRuleCoverage(result.checks, {
        notRequested: result.coverage.skipped.length,
        failed: result.coverage.failed.length,
        notRequestedNames: result.coverage.skipped,
        failedNames: result.coverage.failed,
      }),
      notes: [...result.gaps.map((gap) => gap.reason), ...serp.notes],
      serps: serp.serps,
      alertRows: serp.alertRows,
    });
  }
  const parsed = legacy.safeParse(raw);
  if (!parsed.success)
    throw badRequest("The SEO report does not match its supported format");
  const result = parsed.data,
    pageUrl = result.request.url,
    at = result.header.capturedAt;
  const findings = result.findings.flatMap((row) =>
    row.devices.map((device) => ({
      id: `${row.id}:${device}`,
      pageUrl,
      device,
      rowId: row.row,
      title: row.name,
      severity: row.level,
      evidence: row.evidence,
      sourceRef: result.snapshotId,
      observedAt: at,
    })),
  );
  const keywords = legacyReportKeywords(result, pageUrl, at);
  const competitors: z.infer<typeof competitor>[] = (
    result.rankingData?.competitors ?? []
  ).map((row) => ({
    pageUrl: row.url,
    role: "competitor" as const,
    scopePageUrls: [pageUrl],
    rank: row.rank,
    backlinks: null,
    referringDomains: row.referringDomains ?? null,
    source: row.source,
    sourceRef: result.snapshotId,
    observedAt: at,
  }));
  if (result.rankingData)
    competitors.push({
      pageUrl,
      role: "page",
      scopePageUrls: [pageUrl],
      rank: null,
      backlinks: numberAt(result.rankingData, ["page", "summary", "backlinks"]),
      referringDomains: numberAt(result.rankingData, [
        "page",
        "referringDomains",
      ]),
      source: "backlinks",
      sourceRef: result.snapshotId,
      observedAt: at,
    });
  return publicSeoPayloadSchema.parse({
    version: 1,
    kind: "audit_full",
    requestId: null,
    pageUrls: [pageUrl],
    observedAt: at,
    countryCode: result.header.market?.country ?? "",
    languageCode: result.header.market?.language ?? "",
    rulebookVersion: result.rulebookVersion,
    checks: result.checklist.map((row) => ({
      rowId: row.row,
      pageUrl,
      device: row.device,
      result: row.result === "not checked" ? "not_checked" : row.result,
    })),
    keywords,
    competitors,
    findings,
    actions: result.actions.map((row) => ({
      id: String(row.n),
      pageUrl,
      findingIds: result.findings
        .filter((item) => row.findings.includes(item.id))
        .flatMap((item) =>
          item.devices.map((device) => `${item.id}:${device}`),
        ),
      title: row.title,
      why: row.why,
      effort: row.effort,
      expectedEffect: row.whatToExpect,
      edit: row.edit ? { ...row.edit, before: row.edit.before ?? null } : null,
    })),
    coverage: {
      checked: result.checklist.filter((row) => row.result !== "not checked")
        .length,
      skipped: result.checklist.filter((row) => row.result === "not checked")
        .length,
      failed: 0,
    },
    notes: result.couldNotSee.map((row) => `${row.item}: ${row.reason}`),
  });
}
