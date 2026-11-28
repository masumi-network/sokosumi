import "server-only";

import {
  type AdminSeoImpactVerdicts,
  type ListAdminSeoImpactVerdictsData,
  listAdminSeoImpactVerdicts,
} from "@sokosumi/core-client";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";
import { executeCoreOperation } from "@/lib/clients/core.request";

type AdminSeoImpactQuery = NonNullable<ListAdminSeoImpactVerdictsData["query"]>;
export type AdminSeoImpactPeriod = NonNullable<AdminSeoImpactQuery["period"]>;
export type AdminSeoImpactSource = NonNullable<AdminSeoImpactQuery["source"]>;
type AdminSeoImpactState = NonNullable<AdminSeoImpactQuery["state"]>;
export type AdminSeoImpactFilters = {
  period: AdminSeoImpactPeriod;
  state?: AdminSeoImpactState;
  source?: AdminSeoImpactSource;
};

export const ADMIN_SEO_IMPACT_PERIODS: AdminSeoImpactPeriod[] = [
  "90",
  "365",
  "all",
];
export const ADMIN_SEO_IMPACT_SOURCES: AdminSeoImpactSource[] = [
  "cuso_done",
  "audit_recheck",
];
const ADMIN_SEO_IMPACT_STATES: AdminSeoImpactState[] = [
  "waiting_crawl",
  "waiting_window",
  "ready",
  "waiting_retry",
  "measured",
  "not_measurable",
];
const DEFAULT_PERIOD: AdminSeoImpactPeriod = "90";

const pick = <T extends string>(options: T[], value: string | undefined) =>
  options.find((option) => option === value);

/** The filters that `?period=`, `?state=` and `?source=` name; an unknown value picks none. */
export function adminSeoImpactFilters(params: {
  period?: string;
  state?: string;
  source?: string;
}): AdminSeoImpactFilters {
  return {
    period: pick(ADMIN_SEO_IMPACT_PERIODS, params.period) ?? DEFAULT_PERIOD,
    state: pick(ADMIN_SEO_IMPACT_STATES, params.state),
    source: pick(ADMIN_SEO_IMPACT_SOURCES, params.source),
  };
}

/** Page changes tracked for an SEO impact verdict, newest change first. */
export async function readAdminSeoImpact(
  filters: AdminSeoImpactFilters,
): Promise<AdminSeoImpactVerdicts> {
  const result = await executeCoreOperation(
    createCoreGeneratedClient,
    (client) =>
      listAdminSeoImpactVerdicts({
        client,
        query: filters,
        cache: "no-store",
      }),
    "Failed to load tracked SEO page changes",
  );
  return result.data;
}
