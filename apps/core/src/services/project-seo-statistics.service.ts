import { z } from "@hono/zod-openapi";
import {
  SEO_STATISTICS_ANALYTICS_LANDING_PAGES_UNAVAILABLE_NOTE,
  SEO_STATISTICS_ANALYTICS_SHARED_LANDING_PATH_NOTE,
  SEO_STATISTICS_BREAKDOWN_UNAVAILABLE_NOTE,
  SEO_STATISTICS_KEYWORD_SERIES_UNAVAILABLE_NOTE,
  SEO_STATISTICS_QUERY_ROWS_ANONYMIZED_NOTE,
  SEO_STATISTICS_QUERY_ROWS_UNAVAILABLE_NOTE,
  seoStatisticsKeywordRowsCutNote,
  seoStatisticsKeywordsLeftOutNote,
  seoStatisticsQueryRowsCutNote,
} from "@sokosumi/utils";

import { conflict, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { auditClickHistoryFromSearchAnalytics } from "@/lib/seo/audit-click-history";
import { readAuditPropertyEvidence } from "@/lib/seo/audit-page-discovery";
import { auditPerformancePage } from "@/lib/seo/audit-performance-pages";
import {
  GSC_LIST_SITEMAPS,
  type inspectionDiscoverySources,
} from "@/lib/seo/audit-sitemaps";
import { ga4LandingPlan } from "@/lib/seo/native-ga4-landing";
import {
  type GscBreakdownDimension,
  gscBreakdownArguments,
  normalizeGscBreakdown,
} from "@/lib/seo/native-gsc-breakdown";
import { GSC_INSPECT_TOOL } from "@/lib/seo/native-gsc-inspection";
import {
  gscPropertyCovers,
  readableGscProperties,
} from "@/lib/seo/native-gsc-property";
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
  applyPreviousSeoPeriod,
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
  connectionVersion,
  recordSeoConnectionFailure,
  resolveSeoStatisticsIntegration,
  type SeoStatisticsIntegration,
} from "@/services/seo-connections.service";
import {
  getProjectSeoWorkspace,
  recordNativeSeoMetrics,
} from "./project-seo.service";
import {
  type AuditStatisticsScope,
  withAutomaticSeoStatistics,
} from "./project-seo-statistics-cache";
import {
  applyStatisticsInspections,
  collectStatisticsInspections,
  inspectionCacheKey,
  inspectStatisticsPage,
} from "./project-seo-statistics-inspections";
import { requireSeoOwner, type SeoMutationHooks } from "./project-seo-store";
import { collectAuditDiscovery } from "./seo-audit-discovery";
import {
  collectLandingPages,
  landingOutcomeAccountKey,
} from "./seo-statistics-landing";

const MAX_PROPERTY_PAGES = 5;
const PROPERTY_PAGE_SIZE = 100;

/** Personal connections stay in the owner's private context, never in shared bot replies. */
async function integrationFor(
  actor: SeoActor,
  provider: SyncProjectSeoStatistics["provider"],
): Promise<SeoStatisticsIntegration | null> {
  await requireSeoOwner(actor);
  if (actor.sokoBotId && actor.privateMetricsAllowed !== true) return null;
  return resolveSeoStatisticsIntegration(actor, provider);
}

async function toolFor(
  integration: ComposioIntegrationAccount,
  slug: string,
  knownTools?: SeoNativeTool[],
): Promise<SeoNativeTool> {
  const tools =
    knownTools ?? (await listIntegrationTools(integration, { limit: 100 }));
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

function readerFor(integration: ComposioIntegrationAccount, slug: string) {
  let tool: Promise<SeoNativeTool> | undefined;
  return async (args: Record<string, unknown>) => {
    tool ??= toolFor(integration, slug);
    return read(integration, await tool, args);
  };
}

/** One read-only Google read on a connected account, its arguments bound to the tool's declared inputs. */
export async function readNativeSeoTool(
  integration: ComposioIntegrationAccount,
  slug: string,
  logical: Record<string, unknown>,
  tools?: SeoNativeTool[],
) {
  return read(integration, await toolFor(integration, slug, tools), logical);
}

export async function propertyChoices(
  integration: ComposioIntegrationAccount,
  provider: SyncProjectSeoStatistics["provider"],
  tools?: SeoNativeTool[],
): Promise<ProjectSeoStatisticsProperties> {
  const properties: Array<{ id: string; name: string }> = [];
  const tool = await toolFor(
    integration,
    provider === "ga4" ? GA4_PROPERTIES_TOOL : GSC_PROPERTIES_TOOL,
    tools,
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
      for (const id of readableGscProperties(payload))
        properties.push({ id, name: id });
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

export async function syncProjectSeoStatistics(
  actor: SeoActor,
  raw: SyncProjectSeoStatistics,
  hooks: SeoMutationHooks = {},
  audit?: AuditStatisticsScope,
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
  if (
    audit &&
    (input.provider !== "search_console" ||
      connectionVersion(integration) !== audit.connectionVersion ||
      pageUrls.length !== audit.pageUrls.length ||
      pageUrls.some((url) => !audit.pageUrls.includes(url)))
  )
    throw conflict(
      "The approved audit pages or Search Console account changed.",
    );
  const readWorkspace = () =>
    getProjectSeoWorkspace(actor, {
      ...(input.scopeId
        ? { scopeId: input.scopeId }
        : pageIds.length === 1
          ? { pageId: pageIds[0] }
          : { pageIds }),
      from: input.from,
      to: input.to,
      channel: input.provider === "search_console" ? "organic" : input.channel,
      ...(input.searchType !== "web" ? { searchType: input.searchType } : {}),
    });
  const retain = async (
    snapshot: Parameters<typeof recordNativeSeoMetrics>[1],
    mutationHooks: SeoMutationHooks,
    outcomes?: NonNullable<
      Parameters<typeof recordNativeSeoMetrics>[2]
    >["outcomes"],
  ) => {
    const current = await integrationFor(actor, input.provider);
    if (
      !current ||
      current.connectionRevision !== integration.connectionRevision ||
      current.composioAccountId !== integration.composioAccountId ||
      current.entityId !== integration.entityId
    )
      throw unprocessableEntity(
        "The native connection changed during statistics collection",
      );
    await recordNativeSeoMetrics(actor, snapshot, {
      ...mutationHooks,
      auditTaskId: audit?.taskId,
      outcomes,
      ...(input.provider === "ga4" && {
        outcomeAccountKey: landingOutcomeAccountKey(integration),
      }),
      scope: {
        id: input.scopeId ?? null,
        version: workspace.scope.version,
        pageIds,
      },
    });
    return readWorkspace();
  };
  return withAutomaticSeoStatistics({
    actor,
    audit,
    input,
    integration,
    pageIds,
    pageUrls,
    keywords: workspace.keywords,
    hooks,
    readWorkspace,
    activate: retain,
    collect: async (fingerprint, collectionHooks, cached) => {
      const choices = await propertyChoices(integration, input.provider).catch(
        async (error) => {
          await recordSeoConnectionFailure(actor, input.provider, integration);
          throw error;
        },
      );
      if (
        !choices.properties.some((property) => property.id === input.propertyId)
      )
        throw unprocessableEntity(
          "The selected property was not returned by this native connection",
        );
      if (
        input.provider === "search_console" &&
        !gscPropertyCovers(input.propertyId, pageUrls)
      )
        throw unprocessableEntity(
          "The Search Console property does not cover the selected pages",
        );
      const readInspection = readerFor(integration, GSC_INSPECT_TOOL);
      const discoverySources = new Map<
        string,
        ReturnType<typeof inspectionDiscoverySources>
      >();
      const collectIndexedPages = () =>
        collectStatisticsInspections(
          actor,
          inspectionCacheKey(actor, integration, input.propertyId),
          pageUrls,
          (url) =>
            inspectStatisticsPage(
              input.propertyId,
              url,
              audit?.includeSitemaps ? discoverySources : undefined,
              readInspection,
            ),
          cached,
          audit?.includeSitemaps ? discoverySources : undefined,
        );
      const readSitemaps = readerFor(integration, GSC_LIST_SITEMAPS);
      const discovery = (
        taskId: string,
        data: Parameters<typeof collectAuditDiscovery>[2],
      ) =>
        collectAuditDiscovery(
          actor,
          taskId,
          data,
          discoverySources,
          readSitemaps,
          cached?.auditDiscovery,
        );
      const readStats = readerFor(
        integration,
        input.provider === "ga4" ? GA4_STATS_TOOL : GSC_STATS_TOOL,
      );
      const property = await readAuditPropertyEvidence(
        input,
        readStats,
        !!audit?.propertyTotals,
        !!audit?.pageDiscovery,
        cached,
      );
      if (
        cached &&
        audit &&
        (cached.auditPerformanceComplete || audit.propertyTotals === "only")
      ) {
        return retain(
          {
            ...cached,
            ...property,
            ...(audit.propertyTotals !== "only" &&
              audit.includeSitemaps && {
                auditDiscovery: await discovery(audit.taskId, cached),
              }),
          },
          collectionHooks,
        );
      }
      if (cached && !audit) {
        const inspections = await collectIndexedPages();
        const updated = {
          ...cached,
          collectedAt: cached.collectedAt ?? cached.observedAt,
          observedAt: new Date().toISOString(),
        };
        applyStatisticsInspections(updated, inspections);
        return retain(updated, collectionHooks);
      }
      const inspections = audit ? await collectIndexedPages() : null;
      const measuredPages = inspections
        ? pageUrls.map((url) =>
            auditPerformancePage(
              input.propertyId,
              url,
              inspections.indexedPages.find((p) => p.pageUrl === url),
            ),
          )
        : null;
      const query: NativeStatisticsQuery = {
        ...input,
        pageUrls: measuredPages
          ? [...new Set(measuredPages.map((page) => page.measuredUrl))]
          : pageUrls,
      };
      const build =
        input.provider === "ga4"
          ? ga4StatisticsArguments
          : gscStatisticsArguments;
      const expected = input.provider === "ga4" ? ["metricHeaders"] : ["rows"];
      const normalize =
        input.provider === "ga4"
          ? normalizeGa4Statistics
          : normalizeGscStatistics;
      const collect = async (daily: boolean) => {
        const payload = unwrapNativeStatistics(
          await readStats(build(query, daily)),
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
      // The daily read is shared: Search Console's earlier window needs its last reported day.
      const dailyRead = collect(true);
      // Totals over the equal window before the reported days, read the same way. Google reports a
      // few days late, so the current total covers [from, last reported day]; the earlier window
      // has as many days, so a reporting delay never reads as a drop. GA4 needs no
      // retention cutoff: its retention setting does not limit aggregated reports.
      const collectPrevious = async () => {
        // GA4 totals cover the requested period. A missing daily row means no traffic, not an earlier period end.
        let end = query.to;
        if (input.provider === "search_console" && !audit) {
          const reported = normalize(query, null, await dailyRead, "")
            .metrics.flatMap((metric) => metric.points)
            .filter((point) => point.value !== null)
            .map((point) => point.date);
          if (!reported.length) throw new Error("No reported day to compare");
          const last = reported.reduce((a, b) => (a > b ? a : b));
          end = searchConsoleSettledEnd(query.to, last);
        }
        const window = previousSeoPeriod(query.from, end);
        // Search Console keeps about 16 months; an older window would be partly empty.
        if (
          input.provider === "search_console" &&
          !withinSearchConsoleRetention(window.from)
        )
          throw new Error(
            "The earlier window is past Search Console retention",
          );
        const earlier = { ...query, ...window };
        const totals = normalize(
          earlier,
          unwrapNativeStatistics(
            await readStats(build(earlier, false)),
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
                await readStats(gscQueryArguments(query)),
                ["rows"],
              ),
            )
          : null;
      const collectBreakdown = async (dimension: GscBreakdownDimension) =>
        input.provider === "search_console"
          ? normalizeGscBreakdown(
              dimension,
              unwrapNativeStatistics(
                await readStats(gscBreakdownArguments(query, dimension)),
                ["rows"],
              ),
              query.searchType,
            )
          : null;
      // Organic key events per landing page. Google Analytics only.
      const landingPlan =
        input.provider === "ga4" ? ga4LandingPlan(query) : null;
      const tracked =
        readsQueries && !audit
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
                  await readStats(gscKeywordSeriesArguments(query, group)),
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
        input.provider === "search_console" && !audit
          ? collectIndexedPages()
          : null,
        collectLandingPages(
          query,
          landingPlan,
          actor,
          workspace.pages,
          integration,
          readStats,
        ),
      ]);
      if (
        !property.auditPropertyTotals &&
        !property.auditPageDiscovery &&
        period.status === "rejected" &&
        daily.status === "rejected"
      ) {
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
      if (previous.status === "fulfilled" && period.status === "fulfilled") {
        applyPreviousSeoPeriod(
          metrics,
          previous.value.totals,
          previous.value.window,
        );
      }
      if (landingPlan) {
        if (landingPlan.skippedUrls.length)
          metrics.notes.push(SEO_STATISTICS_ANALYTICS_SHARED_LANDING_PATH_NOTE);
        if (landing.status === "fulfilled" && landing.value) {
          metrics.landingPages = landing.value.landingPages;
          metrics.landingEngagementEvidence =
            landing.value.landingEngagementEvidence;
        } else if (landingPlan.query.pageUrls.length)
          metrics.notes.push(
            SEO_STATISTICS_ANALYTICS_LANDING_PAGES_UNAVAILABLE_NOTE,
          );
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
          } else
            metrics.notes.push(SEO_STATISTICS_KEYWORD_SERIES_UNAVAILABLE_NOTE);
        }
        const country =
          byCountry.status === "fulfilled" ? byCountry.value : null;
        if (country?.feed) metrics.feedCountries = country.split;
        else if (country) metrics.countries = country.split;
        const device = byDevice.status === "fulfilled" ? byDevice.value : null;
        if (device?.feed) metrics.feedDevices = device.split;
        else if (device) metrics.devices = device.split;
        if (byCountry.status === "rejected" || byDevice.status === "rejected")
          metrics.notes.push(SEO_STATISTICS_BREAKDOWN_UNAVAILABLE_NOTE);
        if (indexed.status === "rejected") throw indexed.reason;
        if (indexed.value) applyStatisticsInspections(metrics, indexed.value);
        if (tracked.leftOut.length)
          metrics.notes.push(
            seoStatisticsKeywordsLeftOutNote(
              tracked.leftOut,
              SEO_KEYWORD_SERIES_MAX_KEYWORDS,
              SEO_KEYWORD_SERIES_MAX_COUNTRIES,
            ),
          );
      }
      if (measuredPages && inspections) {
        // The evidence belongs to the approved page records. Query rows retain Google's measured URLs.
        metrics.pageUrls = pageUrls;
        metrics.auditMeasuredPages = measuredPages;
        Object.assign(metrics, property);
        if (audit?.includeSitemaps) {
          applyStatisticsInspections(metrics, inspections);
          metrics.auditDiscovery = await discovery(audit.taskId, metrics);
        }
        metrics.auditPerformanceComplete =
          inspections.indexedPages.length === pageUrls.length &&
          [period, daily, previous, queries].every(
            (result) => result.status === "fulfilled",
          );
        if (
          metrics.auditPerformanceComplete &&
          metrics.metrics.find((metric) => metric.key === "impressions")
            ?.value != null &&
          metrics.metrics.find((metric) => metric.key === "impressions")
            ?.previous?.value != null &&
          (metrics.metrics.some((metric) => metric.points.length > 0) ||
            metrics.metrics.find((metric) => metric.key === "impressions")
              ?.value === 0)
        )
          metrics.coverage = "complete";
        if (
          metrics.coverage === "complete" &&
          measuredPages.every((page) => page.basis !== "unverified")
        ) {
          metrics.auditClickHistory =
            await auditClickHistoryFromSearchAnalytics(
              metrics,
              query,
              readStats,
            );
        }
      }
      metrics.collectionFingerprint = fingerprint;
      metrics.collectedAt = metrics.observedAt;
      return retain(
        metrics,
        collectionHooks,
        landing.status === "fulfilled" ? landing.value?.outcomes : undefined,
      );
    },
  });
}
