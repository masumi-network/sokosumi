import { seoSearchSiteHost } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { conflict, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { GSC_INSPECT_TOOL } from "@/lib/seo/native-gsc-inspection";
import { gscPropertyCovers } from "@/lib/seo/native-gsc-property";
import { GSC_STATS_TOOL } from "@/lib/seo/native-statistics";
import { readSiteTraffic } from "@/lib/seo/site-traffic";
import type { SeoActor } from "@/schemas/project-seo.schema";
import type { SiteTrafficInput } from "@/schemas/seo-site-traffic.schema";
import { listIntegrationTools } from "./composio-integration-tools.service";
import { loadSeoBrandTerms } from "./project-seo-settings.service";
import {
  propertyChoices,
  readNativeSeoTool,
} from "./project-seo-statistics.service";
import {
  collectStatisticsInspections,
  inspectionCacheKey,
  inspectStatisticsPage,
} from "./project-seo-statistics-inspections";
import {
  requireSeoOwner,
  requireSeoPages,
  seoOwnerWhere,
} from "./project-seo-store";
import {
  connectionVersion,
  resolveSeoStatisticsIntegration,
} from "./seo-connections.service";

export async function getSeoSiteTraffic(
  actor: SeoActor,
  input: SiteTrafficInput,
) {
  const owner = await requireSeoOwner(actor);
  const where = seoOwnerWhere(actor);
  const [first, selected, brandTerms] = await Promise.all([
    owner.websiteUrl
      ? null
      : prisma.projectSeoPage.findFirst({
          where: { ...where, relationship: "primary" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { url: true },
        }),
    requireSeoPages(actor, input.pageIds),
    // The split is an extra: without the terms the report has totals and pages only.
    loadSeoBrandTerms(actor).catch(() => undefined),
  ]);
  const siteUrl = owner.websiteUrl ?? first?.url;
  const urls = selected.map((p) => p.url);
  if (
    !siteUrl ||
    urls.some((url) => seoSearchSiteHost(url) !== seoSearchSiteHost(siteUrl)) ||
    !gscPropertyCovers(input.propertyId, urls)
  )
    throw unprocessableEntity(
      "Select pages and a Search Console property for this website.",
    );
  const account = await resolveSeoStatisticsIntegration(
    actor,
    "search_console",
  );
  if (!account) throw conflict("Search Console connection unavailable.");
  try {
    const tools = await listIntegrationTools(account, { limit: 100 });
    const choices = await propertyChoices(account, "search_console", tools);
    if (!choices.properties.some((p) => p.id === input.propertyId))
      throw unprocessableEntity(
        "Selected Search Console property is unavailable.",
      );
    const cacheKey = inspectionCacheKey(actor, account, input.propertyId);
    const inspections = await collectStatisticsInspections(
      actor,
      cacheKey,
      urls,
      (url) =>
        inspectStatisticsPage(input.propertyId, url, undefined, (args) =>
          readNativeSeoTool(account, GSC_INSPECT_TOOL, args, tools),
        ),
    );
    const data = await readSiteTraffic(
      input,
      siteUrl,
      urls,
      inspections.indexedPages,
      (args) => readNativeSeoTool(account, GSC_STATS_TOOL, args, tools),
      brandTerms,
    );
    const current = await resolveSeoStatisticsIntegration(
      actor,
      "search_console",
    );
    if (!current || connectionVersion(current) !== connectionVersion(account))
      throw conflict("Search Console connection changed.");
    return data;
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    recordCoreWarning(
      { operation: "seo_site_traffic" },
      {
        message: "Search Console traffic could not be read.",
        why: "The provider read or response validation failed.",
      },
      { failure: messageSafeErrorFields(error) },
    );
    throw unprocessableEntity(
      "Could not read Search Console traffic for this website.",
    );
  }
}
