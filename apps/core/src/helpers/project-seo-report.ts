import { z } from "@hono/zod-openapi";

import { badRequest } from "@/helpers/error";
import {
  seoDeviceSchema,
  seoSeveritySchema,
  seoUrlSchema,
} from "@/schemas/project-seo.schema";
import { assertValidPartialSeoActions } from "./project-seo-partial-actions";

const text = z.string().max(20_000);
const nullableNumber = z.number().finite().nullable();
const observedAt = z.string().datetime();
const source = z.object({ sourceRef: text, observedAt });
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
  intent: text.nullable().optional(),
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
  }),
  notes: z.array(text).max(500),
});
export type PublicSeoPayload = z.infer<typeof publicSeoPayloadSchema>;

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
    pageUrls = request.pageUrls.map(normalizedUrl);
  if (
    payload.kind !== expected.kind ||
    !sameSet(payload.pageUrls.map(normalizedUrl), pageUrls) ||
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
    keywords: z.array(keyword).max(5000),
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
  keywordOpportunities: z
    .object({
      list: z.array(
        z.object({
          keyword: text,
          volume: z.number().finite(),
          position: nullableNumber,
          intent: text.nullable(),
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
      first = pages[0];
    return publicSeoPayloadSchema.parse({
      ...first,
      kind: "audit_full",
      pageUrls: pages.flatMap((page) => page.pageUrls),
      checks: pages.flatMap((page) => page.checks),
      keywords: pages.flatMap((page) => page.keywords),
      competitors: pages.flatMap((page) => page.competitors),
      findings: pages.flatMap((page, index) =>
        page.findings.map((row) => ({ ...row, id: `${index}:${row.id}` })),
      ),
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
      notes: pages.flatMap((page) => page.notes),
    });
  }
  if (object(raw)?.schema === "sokosumi.seo-result/1") {
    const parsed = partial.safeParse(raw);
    if (!parsed.success)
      throw badRequest("The SEO result does not match its supported format");
    const result = parsed.data;
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
      coverage: {
        checked: result.checks.filter((check) => check.result !== "not_checked")
          .length,
        skipped: result.coverage.skipped.length,
        failed: result.coverage.failed.length,
      },
      notes: result.gaps.map((gap) => gap.reason),
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
  const keywords: z.infer<typeof keyword>[] =
    result.header.focusKeywords.flatMap((row) =>
      ["mobile", "desktop"].map((device) => {
        const d = seoDeviceSchema.parse(device),
          position = row.position[d],
          note = row.positionNote[d];
        return {
          keyword: row.keyword,
          pageUrl,
          device: d,
          position,
          positionStatus:
            position !== null
              ? ("ranked" as const)
              : note?.startsWith("not in the top")
                ? ("not_in_range" as const)
                : ("unavailable" as const),
          checkedResults: note?.match(/top (\d+)/)?.[1]
            ? Number(note.match(/top (\d+)/)?.[1])
            : null,
          volume: row.volume,
          intent: row.intent,
          source: "focus",
          sourceRef: result.snapshotId,
          observedAt: at,
        };
      }),
    );
  for (const row of result.rankingData?.page?.ranked?.rows ?? [])
    if (row.keyword)
      keywords.push({
        keyword: row.keyword,
        pageUrl,
        device: null,
        position: row.position,
        positionStatus: row.position === null ? "unavailable" : "ranked",
        checkedResults: null,
        volume: row.volume,
        intent: row.intent,
        source: "ranked",
        sourceRef: result.snapshotId,
        observedAt: at,
      });
  for (const row of result.rankingData?.gaps ?? [])
    keywords.push({
      keyword: row.keyword,
      pageUrl,
      device: null,
      position: null,
      positionStatus: "unavailable",
      checkedResults: null,
      volume: row.bestVolume,
      intent: null,
      source: "gap",
      sourceRef: result.snapshotId,
      observedAt: at,
    });
  for (const row of result.keywordOpportunities?.list ?? [])
    keywords.push({
      keyword: row.keyword,
      pageUrl,
      device: null,
      position: row.position,
      positionStatus: row.position === null ? "unavailable" : "ranked",
      checkedResults: null,
      volume: row.volume,
      intent: row.intent,
      source: "opportunity",
      sourceRef: result.snapshotId,
      observedAt: at,
    });
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
      findingIds: findings
        .filter((item) => row.findings.includes(item.rowId))
        .map((item) => item.id),
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
