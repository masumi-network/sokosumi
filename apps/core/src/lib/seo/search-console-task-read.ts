import { z } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { badGateway } from "@/helpers/error";
import type {
  SeoTaskSearchConsoleRead,
  SeoTaskSearchConsoleReply,
} from "@/schemas/seo-task-search-console.schema";
import {
  GSC_INSPECT_TOOL,
  gscInspectionArguments,
} from "./native-gsc-inspection";
import {
  GSC_PROPERTIES_TOOL,
  GSC_STATS_TOOL,
  unwrapNativeStatistics,
} from "./native-statistics";

/** The largest Google body Core forwards to the worker. A larger one is refused, never cut. */
export const GSC_TASK_REPLY_MAX_BYTES = 2 * 1024 * 1024;
/** Durable per-Task read budget for each operation. */
export const GSC_TASK_READ_BUDGET = {
  "sites.list": 10,
  "urlInspection.inspect": 60,
  "searchAnalytics.query": 400,
} as const satisfies Record<SeoTaskSearchConsoleRead["operation"], number>;

/** The production Composio tool and the keys of Google's native body for each operation. */
export const GSC_TASK_OPERATIONS = {
  "sites.list": { tool: GSC_PROPERTIES_TOOL, keys: ["siteEntry"] },
  "searchAnalytics.query": {
    tool: GSC_STATS_TOOL,
    keys: ["rows", "responseAggregationType"],
  },
  "urlInspection.inspect": {
    tool: GSC_INSPECT_TOOL,
    keys: ["inspectionResult"],
  },
} as const satisfies Record<
  SeoTaskSearchConsoleRead["operation"],
  { tool: string; keys: string[] }
>;

/** Tool arguments in the names production reads already use. The property is always Core's frozen one. */
export function gscTaskToolArguments(
  read: SeoTaskSearchConsoleRead,
  propertyId: string,
): Record<string, unknown> {
  if (read.operation === "sites.list") return {};
  if (read.operation === "urlInspection.inspect")
    return gscInspectionArguments(propertyId, read.inspectionUrl);
  const { query } = read;
  return {
    site_url: propertyId,
    start_date: query.startDate,
    end_date: query.endDate,
    row_limit: query.rowLimit,
    start_row: query.startRow,
    // The same defaults as gscReportArguments, the proven production read.
    dimensions: query.dimensions ?? [],
    search_type: query.type ?? "web",
    data_state: query.dataState ?? "final",
    ...(query.dimensionFilterGroups && {
      dimension_filter_groups: query.dimensionFilterGroups,
    }),
    ...(query.aggregationType && { aggregation_type: query.aggregationType }),
  };
}

/**
 * Parts of a credential key name, matched after case and `_`/`-` are removed.
 * No documented key of the three Google replies holds one of them.
 */
const CREDENTIAL_KEY_PARTS = [
  "token",
  "secret",
  "password",
  "authorization",
  "apikey",
  "bearer",
  "cookie",
  "connectedaccountid",
  "authconfigid",
];

/** True when any object key at any depth names a credential. */
export function holdsCredentialField(value: unknown): boolean {
  const stack = [value];
  while (stack.length) {
    const item = stack.pop();
    if (item === null || typeof item !== "object") continue;
    if (Array.isArray(item)) {
      stack.push(...item);
      continue;
    }
    for (const [key, child] of Object.entries(item)) {
      const name = key.replace(/[_-]/g, "").toLowerCase();
      if (CREDENTIAL_KEY_PARTS.some((part) => name.includes(part))) return true;
      stack.push(child);
    }
  }
  return false;
}

const metric = z
  .union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i)])
  .transform(Number)
  .pipe(z.number().finite());
const sitesSchema = z.object({
  siteEntry: z
    .array(
      z.object({
        siteUrl: z.string().max(500),
        permissionLevel: z.string().max(100).nullish(),
      }),
    )
    .default([]),
});
const analyticsSchema = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()).optional(),
        clicks: metric,
        impressions: metric,
        ctr: metric,
        // Discover and Google News rows may have no position.
        position: metric.optional(),
      }),
    )
    .optional(),
  responseAggregationType: z.string().max(100).optional(),
  // Google adds this for dataState "all".
  metadata: z
    .object({
      firstIncompleteDate: z.string().max(100).optional(),
      firstIncompleteHour: z.string().max(100).optional(),
    })
    .optional(),
});
const inspectionSchema = z.object({
  inspectionResult: z.record(z.string(), z.unknown()),
});

/**
 * Bound, check and project one tool answer into Google's native body. The
 * site list keeps only the audit's approved property, so the owner's other
 * properties never leave Core.
 */
export function gscTaskReplyBody(
  read: SeoTaskSearchConsoleRead,
  propertyId: string,
  data: unknown,
): SeoTaskSearchConsoleReply {
  const size = Buffer.byteLength(
    typeof data === "string" ? data : (JSON.stringify(data) ?? ""),
  );
  if (size > GSC_TASK_REPLY_MAX_BYTES)
    throw badGateway("The Search Console reply is larger than Core forwards", {
      kind: CORE_API_ERROR_KINDS.SEO_GSC_RESPONSE_TOO_LARGE,
    });
  const { keys } = GSC_TASK_OPERATIONS[read.operation];
  const body = unwrapNativeStatistics(data, keys);
  if (holdsCredentialField(body))
    throw badGateway("The Search Console reply was refused");
  const unsupported = () =>
    badGateway("The Search Console reply has an unsupported format");
  // A renamed envelope must not read as "no rows". An empty object still does.
  if (
    !keys.some((key) => Object.hasOwn(body, key)) &&
    Object.keys(body).some((key) => key !== "kind")
  )
    throw unsupported();
  const parsed = (() => {
    if (read.operation === "sites.list") {
      const sites = sitesSchema.safeParse(body);
      return sites.success
        ? {
            siteEntry: sites.data.siteEntry.filter(
              (entry) => entry.siteUrl === propertyId,
            ),
          }
        : null;
    }
    const schema =
      read.operation === "searchAnalytics.query"
        ? analyticsSchema
        : inspectionSchema;
    const result = schema.safeParse(body);
    return result.success ? result.data : null;
  })();
  if (!parsed) throw unsupported();
  return { status: 200, body: parsed };
}
