import type { Prisma } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { getComposio } from "@/clients/composio.client";
import { conflict } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  GSC_INSPECT_TOOL,
  gscInspectionArguments,
} from "@/lib/seo/native-gsc-inspection";
import { gscPropertyCovers } from "@/lib/seo/native-gsc-property";
import { normalizeGscTaskInspection } from "@/lib/seo/native-gsc-task-inspection";
import {
  GSC_STATS_TOOL,
  gscSearchAnalyticsArguments,
  type NativeStatisticsQuery,
  normalizeGscStatistics,
  searchConsoleSettledEnd,
  unwrapNativeStatistics,
} from "@/lib/seo/native-statistics";
import type { SeoActor } from "@/schemas/project-seo.schema";
import {
  integrationFixtureMode,
  listIntegrationTools,
} from "./composio-integration-tools.service";
import {
  propertyChoices,
  readNativeSeoTool,
} from "./project-seo-statistics.service";
import { canReadPrivateSeoMetrics } from "./project-seo-store";
import {
  connectionVersion,
  latestSeoSearchConsoleProperty,
  lockSeoSearchConsoleIntegration,
  recordSeoConnectionFailure,
  resolveSeoStatisticsIntegration,
  type SeoStatisticsIntegration,
  seoConnectionKey,
} from "./seo-connections.service";

export interface AuditSearchConsoleProof {
  propertyId: string;
  connectionVersion: string;
  includeSitemaps?: true;
  includePropertyTotals?: true;
  includePageDiscovery?: true;
}

function unavailable() {
  return conflict("Search Console access could not be verified. Try again.", {
    kind: CORE_API_ERROR_KINDS.SEO_GSC_UNAVAILABLE,
  });
}

function reconnect() {
  return conflict(
    "Connect a Search Console account to use it for this audit.",
    {
      kind: CORE_API_ERROR_KINDS.SEO_GSC_RECONNECT,
    },
  );
}

function resolveAuditIntegration(
  read: () => Promise<SeoStatisticsIntegration | null>,
) {
  return read().catch((error: unknown) => {
    // More than one inherited account requires an explicit native account choice.
    if (error instanceof HTTPException && error.status === 409)
      throw reconnect();
    throw error;
  });
}

async function needsReconnect(actor: SeoActor) {
  const row = await prisma.seoConnection.findUnique({
    where: {
      workspaceId_userId_provider: seoConnectionKey(actor, "search_console"),
    },
    select: { status: true },
  });
  return row?.status === "NEEDS_RECONNECT";
}

async function checkedRead<T>(
  actor: SeoActor,
  integration: SeoStatisticsIntegration,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch {
    await recordSeoConnectionFailure(actor, "search_console", integration);
    if (await needsReconnect(actor)) throw reconnect();
    throw unavailable();
  }
}

/** Check the actual approved pages on the owner's account before creating paid work. */
export async function checkAuditSearchConsole(
  actor: SeoActor,
  pages: { id: string; url: string }[],
  requestedProperty?: string,
  expectedConnectionVersion?: string,
): Promise<AuditSearchConsoleProof> {
  if (integrationFixtureMode() || !getComposio()) throw unavailable();
  if (!(await canReadPrivateSeoMetrics(actor))) throw unavailable();
  const integration = await resolveAuditIntegration(() =>
    resolveSeoStatisticsIntegration(actor, "search_console"),
  );
  if (!integration) {
    if (await needsReconnect(actor)) throw reconnect();
    throw conflict("Connect Search Console to use it for this audit.", {
      kind: CORE_API_ERROR_KINDS.SEO_GSC_NOT_CONNECTED,
    });
  }
  if (
    expectedConnectionVersion &&
    connectionVersion(integration) !== expectedConnectionVersion
  )
    throw unavailable();
  const pageUrls = pages.map((page) => page.url);
  const tools = await checkedRead(actor, integration, () =>
    listIntegrationTools(integration, { limit: 100 }),
  );
  const choices = await checkedRead(actor, integration, () =>
    propertyChoices(integration, "search_console", tools),
  );
  const matching = choices.properties.filter(({ id }) =>
    gscPropertyCovers(id, pageUrls),
  );
  const selected =
    requestedProperty ??
    (await latestSeoSearchConsoleProperty(
      actor,
      pages.map((page) => page.id),
    ));
  const property = selected
    ? matching.find(({ id }) => id === selected)
    : matching.length === 1
      ? matching[0]
      : undefined;
  if (!property)
    throw conflict(
      "Choose a Search Console property that you can read and that covers every audit page.",
      {
        kind: CORE_API_ERROR_KINDS.SEO_GSC_PROPERTY,
      },
    );

  // One ungrouped row for the approved pages is sufficient to test read access. A quiet day can have no rows.
  // The property covers every seed. An exact filter for one seed also fits Google's limit for long URLs.
  const seed = pageUrls[0]!;
  const now = new Date();
  const day = searchConsoleSettledEnd(now.toISOString().slice(0, 10), "", now);
  const query: NativeStatisticsQuery = {
    provider: "search_console",
    propertyId: property.id,
    pageUrls: [seed],
    from: day,
    to: day,
    channel: "organic",
  };
  await checkedRead(actor, integration, async () => {
    const payload = unwrapNativeStatistics(
      await readNativeSeoTool(
        integration,
        GSC_STATS_TOOL,
        gscSearchAnalyticsArguments(query, [], 1, "equals"),
        tools,
      ),
      ["rows", "responseAggregationType"],
    );
    if (
      !("rows" in payload) &&
      !("responseAggregationType" in payload) &&
      Object.keys(payload).length
    )
      throw new Error("Unsupported Search Analytics response");
    normalizeGscStatistics(query, payload, null, now.toISOString());
    // The private worker also needs URL Inspection. A valid unknown verdict confirms access.
    const inspection = await readNativeSeoTool(
      integration,
      GSC_INSPECT_TOOL,
      gscInspectionArguments(property.id, seed),
      tools,
    );
    normalizeGscTaskInspection(
      seed,
      unwrapNativeStatistics(inspection, ["inspectionResult"]),
    );
  });
  return {
    propertyId: property.id,
    connectionVersion: connectionVersion(integration),
  };
}

export async function assertAuditSearchConsoleCurrent(
  actor: SeoActor,
  proof: AuditSearchConsoleProof,
  tx: Prisma.TransactionClient,
) {
  const current = await resolveAuditIntegration(() =>
    lockSeoSearchConsoleIntegration(actor, tx),
  );
  if (!current || connectionVersion(current) !== proof.connectionVersion)
    throw unavailable();
}
