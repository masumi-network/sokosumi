import "server-only";

import {
  type AdminSeoImpactVerdicts,
  type ListAdminSeoImpactVerdictsData,
  listAdminSeoImpactVerdicts,
} from "@sokosumi/core-client";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";
import { executeCoreOperation } from "@/lib/clients/core.request";

export type AdminSeoImpactPeriod = NonNullable<
  NonNullable<ListAdminSeoImpactVerdictsData["query"]>["period"]
>;
export const ADMIN_SEO_IMPACT_PERIODS: AdminSeoImpactPeriod[] = [
  "90",
  "365",
  "all",
];
const DEFAULT_PERIOD: AdminSeoImpactPeriod = "90";

/** The period a `?period=` search param names, or the default one. */
export function adminSeoImpactPeriod(
  value: string | undefined,
): AdminSeoImpactPeriod {
  return (
    ADMIN_SEO_IMPACT_PERIODS.find((period) => period === value) ??
    DEFAULT_PERIOD
  );
}

/** Page changes tracked for an SEO impact verdict, newest change first. */
export async function readAdminSeoImpact(
  period: AdminSeoImpactPeriod,
): Promise<AdminSeoImpactVerdicts> {
  const result = await executeCoreOperation(
    createCoreGeneratedClient,
    (client) =>
      listAdminSeoImpactVerdicts({
        client,
        query: { period },
        cache: "no-store",
      }),
    "Failed to load tracked SEO page changes",
  );
  return result.data;
}
