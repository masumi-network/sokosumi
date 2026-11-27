import "server-only";

import {
  type ListAdminSeoActionImpactData,
  type ListAdminSeoAlertsData,
  listAdminSeoActionImpact,
  listAdminSeoAlerts,
} from "@sokosumi/core-client";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";
import { executeCoreOperation } from "@/lib/clients/core.request";

export async function readAdminSeoAlerts(
  query: ListAdminSeoAlertsData["query"],
) {
  const result = await executeCoreOperation(
    createCoreGeneratedClient,
    (client) => listAdminSeoAlerts({ client, query, cache: "no-store" }),
    "Failed to load SEO audit alerts",
  );
  return result.data;
}

export async function readAdminSeoActionImpact(
  query: ListAdminSeoActionImpactData["query"],
) {
  const result = await executeCoreOperation(
    createCoreGeneratedClient,
    (client) => listAdminSeoActionImpact({ client, query, cache: "no-store" }),
    "Failed to load the impact of SEO actions",
  );
  return result.data;
}
