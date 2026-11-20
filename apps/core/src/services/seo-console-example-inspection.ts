import { conflict, forbidden } from "@/helpers/error";
import {
  GSC_INSPECT_TOOL,
  gscInspectionArguments,
  normalizeGscInspection,
} from "@/lib/seo/native-gsc-inspection";
import { gscPropertyCovers } from "@/lib/seo/native-gsc-property";
import { unwrapNativeStatistics } from "@/lib/seo/native-statistics";
import type { SeoActor } from "@/schemas/project-seo.schema";
import type { ConsoleExportSnapshot } from "@/schemas/seo-console-export.schema";
import { listIntegrationTools } from "./composio-integration-tools.service";
import {
  propertyChoices,
  readNativeSeoTool,
} from "./project-seo-statistics.service";
import type { AuditSearchConsoleProof } from "./seo-audit-search-console";
import {
  connectionVersion,
  resolveSeoStatisticsIntegration,
} from "./seo-connections.service";

const MAX_EXAMPLES = 3;
const INSPECTABLE = new Set([
  "discovered_not_indexed",
  "crawled_not_indexed",
  "not_found",
]);

export function canInspectConsoleReason(
  reason: ConsoleExportSnapshot["reason"],
) {
  return reason !== null && INSPECTABLE.has(reason);
}

/** The caller checks the completed audit's requester and frozen access before and after these provider calls. */
export async function inspectConsoleExamples(
  actor: SeoActor,
  access: AuditSearchConsoleProof,
  rows: readonly { key: string }[],
  auditedUrls: ReadonlySet<string>,
  reason: ConsoleExportSnapshot["reason"],
) {
  if (!canInspectConsoleReason(reason)) return [];
  // An owner-supplied example need not be an audited page. Prefer audited URLs to keep checks actionable.
  const keys = [...new Set(rows.map((row) => row.key))];
  if (
    keys.some((key) => {
      const url = URL.parse(key);
      return (
        !url ||
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash ||
        url.href !== key
      );
    }) ||
    !gscPropertyCovers(access.propertyId, keys)
  )
    throw forbidden(
      "The examples must belong to the approved Search Console property",
    );
  const selected = keys
    .sort((a, b) => Number(auditedUrls.has(b)) - Number(auditedUrls.has(a)))
    .slice(0, MAX_EXAMPLES);
  if (!selected.length) return [];
  const integration = await resolveSeoStatisticsIntegration(
    actor,
    "search_console",
  );
  if (
    !integration ||
    connectionVersion(integration) !== access.connectionVersion
  )
    throw conflict("The Search Console account changed before inspection");
  const tools = await listIntegrationTools(integration, { limit: 100 });
  const properties = await propertyChoices(
    integration,
    "search_console",
    tools,
  );
  if (!properties.properties.some((p) => p.id === access.propertyId))
    throw forbidden(
      "The approved Search Console property is no longer available",
    );
  const observations = [];
  for (const key of selected) {
    const checkedAt = new Date().toISOString();
    try {
      const raw = await readNativeSeoTool(
        integration,
        GSC_INSPECT_TOOL,
        gscInspectionArguments(access.propertyId, key),
        tools,
      );
      const { verdict } = normalizeGscInspection(
        key,
        unwrapNativeStatistics(raw, ["inspectionResult"]),
      );
      observations.push({
        key,
        inspection: { status: "observed" as const, checkedAt, verdict },
      });
    } catch {
      observations.push({
        key,
        inspection: { status: "unavailable" as const, checkedAt },
      });
    }
  }
  return observations;
}
