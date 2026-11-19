import "server-only";

import {
  type ListAdminSeoAlertsData,
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
