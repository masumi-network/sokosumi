import { z } from "@hono/zod-openapi";
import {
  SEO_STATISTICS_BREAKDOWN_UNAVAILABLE_NOTE,
  SEO_STATISTICS_INDEX_STATUS_UNAVAILABLE_NOTE,
  SEO_STATISTICS_KEYWORD_SERIES_UNAVAILABLE_NOTE,
  SEO_STATISTICS_QUERY_ROWS_ANONYMIZED_NOTE,
  SEO_STATISTICS_QUERY_ROWS_UNAVAILABLE_NOTE,
  seoStatisticsKeywordRowsCutNote,
  seoStatisticsKeywordsLeftOutNote,
  seoStatisticsQueryRowsCutNote,
} from "@sokosumi/utils";

import { conflict, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  GA4_LANDING_PAGES_UNAVAILABLE_NOTE,
  ga4LandingPageArguments,
  ga4LandingPlan,
  normalizeGa4LandingPages,
} from "@/lib/seo/native-ga4-landing";
import {
  type GscBreakdownDimension,
  gscBreakdownArguments,
  normalizeGscBreakdown,
} from "@/lib/seo/native-gsc-breakdown";
import {
  GSC_INSPECT_TOOL,
  gscInspectionArguments,
  normalizeGscInspection,
} from "@/lib/seo/native-gsc-inspection";
import {
  gscKeywordSeriesArguments,
  gscQueryArguments,
  type NativeKeywordSeries,
  type NativeSearchQueries,
  normalizeGscKeywordSeries,
  normalizeGscQueries,
  selectTrackedKeywords,
} from "@/lib/seo/native-gsc-queries";
import {
  bindSeoToolArguments,
  GA4_PROPERTIES_TOOL,
  GA4_STATS_TOOL,
  GSC_PROPERTIES_TOOL,
  GSC_STATS_TOOL,
  ga4StatisticsArguments,
  gscStatisticsArguments,
  type NativeStatisticsQuery,
  normalizeGa4Statistics,
  normalizeGscStatistics,
  previousSeoPeriod,
  type SeoNativeTool,
  searchConsoleSettledEnd,
  unwrapNativeStatistics,
  withinSearchConsoleRetention,
} from "@/lib/seo/native-statistics";
import {
  SEO_KEYWORD_SERIES_MAX_COUNTRIES,
  SEO_KEYWORD_SERIES_MAX_KEYWORDS,
  SEO_MAX_PAGES,
  type SeoActor,
} from "@/schemas/project-seo.schema";
import {
  type ProjectSeoStatisticsProperties,
  type SyncProjectSeoStatistics,
  syncProjectSeoStatisticsSchema,
} from "@/schemas/project-seo-statistics.schema";
import { seoSearchTypeHasQueries } from "@/schemas/project-seo-traffic.schema";
import type { ComposioIntegrationAccount } from "@/services/composio-integration-tools.service";
import {
  listIntegrationTools,
  readIntegrationTool,
} from "@/services/composio-integration-tools.service";
import {
  recordSeoConnectionFailure,
  resolveSeoStatisticsIntegration,
} from "@/services/seo-connections.service";
import {
  getProjectSeoWorkspace,
  recordNativeSeoMetrics,
} from "./project-seo.service";
import { requireSeoOwner, type SeoMutationHooks } from "./project-seo-store";

const MAX_PROPERTY_PAGES = 5;
const PROPERTY_PAGE_SIZE = 100;

/** Personal connections stay in the owner's private context, never in shared bot replies. */
async function integrationFor(
  actor: SeoActor,
  provider: SyncProjectSeoStatistics["provider"],
): Promise<ComposioIntegrationAccount | null> {
  await requireSeoOwner(actor);
  if (actor.sokoBotId && actor.privateMetricsAllowed !== true) return null;
  return resolveSeoStatisticsIntegration(actor, provider);
}

async function toolFor(
  integration: ComposioIntegrationAccount,
  slug: string,
): Promise<SeoNativeTool> {
  const tools = await listIntegrationTools(integration, { limit: 100 });
  const tool = tools.find((candidate) => candidate.slug === slug);
  if (!tool?.readOnly || !tool.inputSchema)
    throw unprocessableEntity(
      "The connected toolkit does not expose the required read-only statistics tool",
    );
  return tool;
}

async function read(
  integration: ComposioIntegrationAccount,
  tool: SeoNativeTool,
  logical: Record<string, unknown>,
) {
  const args = bindSeoToolArguments(tool, logical);
  return readIntegrationTool(integration, tool.slug, args);
}

async function propertyChoices(
  integration: ComposioIntegrationAccount,
  provider: SyncProjectSeoStatistics["provider"],
): Promise<ProjectSeoStatisticsProperties> {
  const properties: Array<{ id: string; name: string }> = [];
  const tool = await toolFor(
    integration,
    provider === "ga4" ? GA4_PROPERTIES_TOOL : GSC_PROPERTIES_TOOL,
  );
  let token: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PROPERTY_PAGES; page++) {
    const logical =
      provider === "ga4"
        ? {
            pageSize: PROPERTY_PAGE_SIZE,
            ...(token ? { pageToken: token } : {}),
          }
        : {};
    const payload = unwrapNativeStatistics(
      await read(integration, tool, logical),
      provider === "ga4" ? ["accountSummaries"] : ["siteEntry"],
    );
    if (provider === "ga4") {
      const body = z
        .object({
          accountSummaries: z
            .array(
              z.object({
                propertySummaries: z
                  .array(
                    z.object({
                      property: z.string().regex(/^properties\/[1-9]\d*$/),
                      displayName: z.string().optional(),
                    }),
                  )
                  .default([]),
              }),
            )
            .default([]),
          nextPageToken: z.string().optional(),
        })
        .parse(payload);
      for (const account of body.accountSummaries)
        for (const property of account.propertySummaries)
          properties.push({
            id: property.property,
            name: property.displayName ?? property.property,
          });
      token = body.nextPageToken;
    } else {
      const body = z
        .object({
          siteEntry: z
            .array(
              z.object({ siteUrl: z.string(), permissionLevel: z.string() }),
            )
            .default([]),
        })
        .parse(payload);
      for (const property of body.siteEntry)
        if (property.permissionLevel !== "siteUnverifiedUser")
          properties.push({ id: property.siteUrl, name: property.siteUrl });
      token = undefined;
    }
    if (!token)
      return {
        provider,
        properties: [
          ...new Map(
            properties.map((property) => [property.id, property]),
          ).values(),
        ],
        status: "available",
        reason: properties.length
          ? null
          : "The connection returned no available properties.",
      };
    if (seen.has(token))
      throw unprocessableEntity(
        "Statistics property pagination repeated a cursor",
      );
    seen.add(token);
  }
  return {
    provider,
    properties,
    status: "partial",
    reason:
      "The connection returned more properties than this bounded request can list.",
  };
}

export async function listProjectSeoStatisticsProperties(
  actor: SeoActor,
  provider: SyncProjectSeoStatistics["provider"],
): Promise<ProjectSeoStatisticsProperties> {
  const integration = await integrationFor(actor, provider);
  if (!integration)
    return {
      provider,
      properties: [],
      status: "not_connected",
      reason: "Connect this account in SEO statistics.",
    };
  try {
    return await propertyChoices(integration, provider);
  } catch {
    await recordSeoConnectionFailure(actor, provider, integration);
    return {
      provider,
      properties: [],
      status: "unavailable",
      reason:
        "The native connection could not provide a supported read-only property list.",
    };
  }
}

function propertyCovers(property: string, urls: string[]): boolean {
  if (property.startsWith("sc-domain:")) {
    const domain = property.slice("sc-domain:".length).toLowerCase();
    return (
      !!domain &&
      urls.every((url) => {
        const host = new URL(url).hostname.toLowerCase();
        return host === domain || host.endsWith(`.${domain}`);
      })
    );
  }
  if (!URL.canParse(property)) return false;
  const prefix = new URL(property);
  return (
    ["https:", "http:"].includes(prefix.protocol) &&
    !prefix.username &&
    !prefix.password &&
    urls.every(
      (url) =>
        new URL(url).origin === prefix.origin && url.startsWith(prefix.href),
    )
  );
}

export async function syncProjectSeoStatistics(
  actor: SeoActor,
  raw: SyncProjectSeoStatistics,
  hooks: SeoMutationHooks = {},
) {
  const input = syncProjectSeoStatisticsSchema.parse(raw);
  await requireSeoOwner(actor, prisma, true);
  const workspace = await getProjectSeoWorkspace(
    actor,
    input.scopeId ? { scopeId: input.scopeId } : {},
  );
  if (input.scopeId && input.expectedScopeVersion !== workspace.scope.version)
    throw conflict(
      "The page group changed. Reload it before collecting statistics.",
    );
  const pageIds = input.pageIds ?? workspace.scope.pageIds;
  if (
    !pageIds.length ||
    pageIds.length > SEO_MAX_PAGES ||
    new Set(pageIds).size !== pageIds.length
  )
    throw unprocessableEntity("Select up to ten distinct pages for statistics");
  const selected = pageIds.map((id) =>
    workspace.pages.find((page) => page.id === id),
  );
  if (selected.some((page) => !page))
    throw unprocessableEntity("A selected page is unavailable in this Project");
  const pageUrls = selected.flatMap((page) => (page ? [page.url] : []));
  const integration = await integrationFor(actor, input.provider);
  if (!integration)
    throw unprocessableEntity("Connect this account in SEO statistics");
  const choices = await propertyChoices(integration, input.provider).catch(
    async (error) => {
      await recordSeoConnectionFailure(actor, input.provider, integration);
      throw error;
    },
  );
  if (!choices.properties.some((property) => property.id === input.propertyId))
    throw unprocessableEntity(
      "The selected property was not returned by this native connection",
    );
  if (
    input.provider === "search_console" &&
    !propertyCovers(input.propertyId, pageUrls)
  )
    throw unprocessableEntity(
      "The Search Console property does not cover the selected pages",
    );
  const tool = await toolFor(
    integration,
    input.provider === "ga4" ? GA4_STATS_TOOL : GSC_STATS_TOOL,
  );
  const query: NativeStatisticsQuery = { ...input, pageUrls };
  const build =
    input.provider === "ga4" ? ga4StatisticsArguments : gscStatisticsArguments;
  const expected = input.provider === "ga4" ? ["metricHeaders"] : ["rows"];
  const normalize =
    input.provider === "ga4" ? normalizeGa4Statistics : normalizeGscStatistics;
  const collect = async (daily: boolean) => {
    const payload = unwrapNativeStatistics(
      await read(integration, tool, build(query, daily)),
      expected,
    );
    // Validate each independent response before combining it, so one malformed half cannot discard the other.
    normalize(
      query,
      daily ? null : payload,
      daily ? payload : null,
      new Date().toISOString(),
    );
    return payload;
  };
  // The daily read is shared: the earlier window needs its last reported day.
  const dailyRead = collect(true);
  // Totals over the equal window before the reported days, read the same way. Google reports a
  // few days late, so the current total covers [from, last reported day]; the earlier window
  // has as many days, so a reporting delay never reads as a drop. GA4 needs no
  // retention cutoff: its retention setting does not limit aggregated reports.
  const collectPrevious = async () => {
    const reported = normalize(query, null, await dailyRead, "")
      .metrics.flatMap((metric) => metric.points)
      .filter((point) => point.value !== null)
      .map((point) => point.date);
    if (!reported.length) throw new Error("No reported day to compare");
    const last = reported.reduce((a, b) => (a > b ? a : b));
    const window = previousSeoPeriod(
      query.from,
      input.provider === "search_console"
        ? searchConsoleSettledEnd(query.to, last)
        : last,
    );
    // Search Console keeps about 16 months; an older window would be partly empty.
    if (
      input.provider === "search_console" &&
      !withinSearchConsoleRetention(window.from)
    )
      throw new Error("The earlier window is past Search Console retention");
    const earlier = { ...query, ...window };
    const totals = normalize(
      earlier,
      unwrapNativeStatistics(
        await read(integration, tool, build(earlier, false)),
        expected,
      ),
      null,
      new Date().toISOString(),
    );
    return { window, totals };
  };
  // Discover and Google News have no search query: no query rows and no keyword days to read.
  // INFERRED from the Search Console help; the API page does not say so (see seoSearchTypeHasQueries).
  const readsQueries =
    input.provider === "search_console" &&
    seoSearchTypeHasQueries(input.searchType);
  const collectQueries = async (): Promise<NativeSearchQueries | null> =>
    readsQueries
      ? normalizeGscQueries(
          query,
          unwrapNativeStatistics(
            await read(integration, tool, gscQueryArguments(query)),
            ["rows"],
          ),
        )
      : null;
  const collectBreakdown = async (dimension: GscBreakdownDimension) =>
    input.provider === "search_console"
      ? normalizeGscBreakdown(
          dimension,
          unwrapNativeStatistics(
            await read(
              integration,
              tool,
              gscBreakdownArguments(query, dimension),
            ),
            ["rows"],
          ),
        )
      : null;
  // Organic key events per landing page. Google Analytics only.
  const landingPlan = input.provider === "ga4" ? ga4LandingPlan(query) : null;
  const collectLandingPages = async () =>
    landingPlan?.query.pageUrls.length
      ? normalizeGa4LandingPages(
          landingPlan.query,
          unwrapNativeStatistics(
            await read(
              integration,
              tool,
              ga4LandingPageArguments(landingPlan.query),
            ),
            ["metricHeaders"],
          ),
        )
      : null;
  // One URL Inspection per page. A page Google did not answer for is left out, never guessed.
  const collectIndexedPages = async () => {
    if (input.provider !== "search_console") return null;
    const inspect = await toolFor(integration, GSC_INSPECT_TOOL);
    const results = await Promise.allSettled(
      pageUrls.map(async (pageUrl) =>
        normalizeGscInspection(
          pageUrl,
          unwrapNativeStatistics(
            await read(
              integration,
              inspect,
              gscInspectionArguments(input.propertyId, pageUrl),
            ),
            ["inspectionResult"],
          ),
        ),
      ),
    );
    return results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
  };
  const tracked = readsQueries
    ? selectTrackedKeywords(workspace.keywords)
    : { groups: [], leftOut: [] };
  // One read per keyword country; any failed read drops the whole series, so no country reads as partial.
  const collectKeywordSeries =
    async (): Promise<NativeKeywordSeries | null> => {
      if (!tracked.groups.length) return null;
      const parts = await Promise.all(
        tracked.groups.map(async (group) =>
          normalizeGscKeywordSeries(
            query,
            group,
            unwrapNativeStatistics(
              await read(
                integration,
                tool,
                gscKeywordSeriesArguments(query, group),
              ),
              ["rows"],
            ),
          ),
        ),
      );
      return {
        rowLimit: parts[0].rowLimit,
        truncated: parts.some((part) => part.truncated),
        keywords: parts.flatMap((part) => part.keywords),
      };
    };
  // Independent reads: native aggregate totals, the daily series, Search Console query rows and tracked keyword days. Distinct users are never summed.
  const [
    period,
    daily,
    queries,
    keywordSeries,
    previous,
    byCountry,
    byDevice,
    indexed,
    landing,
  ] = await Promise.allSettled([
    collect(false),
    dailyRead,
    collectQueries(),
    collectKeywordSeries(),
    collectPrevious(),
    collectBreakdown("country"),
    collectBreakdown("device"),
    collectIndexedPages(),
    collectLandingPages(),
  ]);
  if (period.status === "rejected" && daily.status === "rejected") {
    await recordSeoConnectionFailure(actor, input.provider, integration);
    throw unprocessableEntity(
      "The native connection could not provide statistics",
    );
  }
  const metrics = normalize(
    query,
    period.status === "fulfilled" ? period.value : null,
    daily.status === "fulfilled" ? daily.value : null,
    new Date().toISOString(),
  );
  // A failed earlier window leaves the change unknown; it never reads as zero.
  if (previous.status === "fulfilled" && period.status === "fulfilled")
    for (const metric of metrics.metrics) {
      const before = previous.value.totals.metrics.find(
        (candidate) => candidate.key === metric.key,
      );
      if (before)
        metric.previous = {
          ...previous.value.window,
          value: before.value,
        };
    }
  if (landingPlan) {
    if (landingPlan.note) metrics.notes.push(landingPlan.note);
    if (landing.status === "fulfilled" && landing.value)
      metrics.landingPages = landing.value;
    else if (landingPlan.query.pageUrls.length)
      metrics.notes.push(GA4_LANDING_PAGES_UNAVAILABLE_NOTE);
  }
  if (input.provider === "search_console") {
    if (queries.status === "fulfilled" && queries.value) {
      metrics.queries = queries.value;
      metrics.notes.push(SEO_STATISTICS_QUERY_ROWS_ANONYMIZED_NOTE);
      if (queries.value.truncated)
        metrics.notes.push(
          seoStatisticsQueryRowsCutNote(queries.value.rowLimit),
        );
    } else if (readsQueries)
      metrics.notes.push(SEO_STATISTICS_QUERY_ROWS_UNAVAILABLE_NOTE);
    if (tracked.groups.length) {
      if (keywordSeries.status === "fulfilled" && keywordSeries.value) {
        metrics.keywordSeries = keywordSeries.value;
        if (keywordSeries.value.truncated)
          metrics.notes.push(
            seoStatisticsKeywordRowsCutNote(keywordSeries.value.rowLimit),
          );
      } else metrics.notes.push(SEO_STATISTICS_KEYWORD_SERIES_UNAVAILABLE_NOTE);
    }
    if (byCountry.status === "fulfilled" && byCountry.value)
      metrics.countries = byCountry.value;
    if (byDevice.status === "fulfilled" && byDevice.value)
      metrics.devices = byDevice.value;
    if (byCountry.status === "rejected" || byDevice.status === "rejected")
      metrics.notes.push(SEO_STATISTICS_BREAKDOWN_UNAVAILABLE_NOTE);
    if (indexed.status === "fulfilled" && indexed.value?.length)
      metrics.indexedPages = indexed.value;
    if (
      indexed.status === "rejected" ||
      (indexed.value?.length ?? 0) < pageUrls.length
    )
      metrics.notes.push(SEO_STATISTICS_INDEX_STATUS_UNAVAILABLE_NOTE);
    if (tracked.leftOut.length)
      metrics.notes.push(
        seoStatisticsKeywordsLeftOutNote(
          tracked.leftOut,
          SEO_KEYWORD_SERIES_MAX_KEYWORDS,
          SEO_KEYWORD_SERIES_MAX_COUNTRIES,
        ),
      );
  }
  const current = await integrationFor(actor, input.provider);
  if (
    !current ||
    current.entityId !== integration.entityId ||
    current.composioAccountId !== integration.composioAccountId
  )
    throw unprocessableEntity(
      "The native connection changed during statistics collection",
    );
  await recordNativeSeoMetrics(actor, metrics, {
    ...hooks,
    scope: {
      id: input.scopeId ?? null,
      version: workspace.scope.version,
      pageIds,
    },
  });
  return getProjectSeoWorkspace(actor, {
    ...(input.scopeId
      ? { scopeId: input.scopeId }
      : pageIds.length === 1
        ? { pageId: pageIds[0] }
        : { pageIds }),
    from: input.from,
    to: input.to,
    channel: metrics.channel,
    ...(input.searchType !== "web" ? { searchType: input.searchType } : {}),
  });
}
