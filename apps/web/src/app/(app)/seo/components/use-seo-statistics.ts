"use client";

import type { ProjectSeoStatisticsProperties } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useSession } from "@/lib/auth/auth.client";
import { formText } from "./seo-form-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const SEO_DEFAULT_STATISTICS_DAYS = 28;
const MILLISECONDS_PER_DAY = 86_400_000;
export function useSeoStatistics(model: SeoWorkspaceModel) {
  const t = useTranslations("App.Seo");
  const { data: session } = useSession();
  const [workspace] = useState(() => model.data);
  const [provider, setProvider] = useState<"ga4" | "search_console">("ga4");
  const [propertyId, setPropertyId] = useState("");
  const [from, setFrom] = useState(
    model.filters.from ??
      new Date(Date.now() - SEO_DEFAULT_STATISTICS_DAYS * MILLISECONDS_PER_DAY)
        .toISOString()
        .slice(0, 10),
  );
  const [to, setTo] = useState(
    model.filters.to ??
      new Date(Date.now() - MILLISECONDS_PER_DAY).toISOString().slice(0, 10),
  );
  const properties = useQuery<ProjectSeoStatisticsProperties>({
    queryKey: [
      "seo-properties",
      session?.session.activeOrganizationId,
      session?.user.id,
      workspace.projectId,
      provider,
    ],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/projects/${workspace.projectId}/seo/statistics/properties?provider=${provider}`,
        { signal, cache: "no-store", credentials: "same-origin" },
      );
      if (!response.ok) throw new Error("Statistics properties unavailable");
      return response.json();
    },
    refetchOnWindowFocus: false,
  });
  const invalidDates =
    !from ||
    !to ||
    from > to ||
    (Date.parse(to) - Date.parse(from)) / MILLISECONDS_PER_DAY >= 366;
  function changeProvider(value: string) {
    if (value !== "ga4" && value !== "search_console") return;
    setProvider(value);
    setPropertyId("");
  }
  async function submit(form: FormData) {
    if (
      invalidDates ||
      !properties.data?.properties.some(
        (property) => property.id === propertyId,
      )
    )
      return;
    const channel =
      provider === "search_console" || formText(form, "channel") === "organic"
        ? "organic"
        : "all";
    const saved = await model.execute(
      {
        kind: "sync_statistics",
        body: {
          provider,
          propertyId,
          from,
          to,
          channel,
          ...(workspace.scope.id
            ? {
                scopeId: workspace.scope.id,
                expectedScopeVersion: workspace.scope.version,
              }
            : { pageIds: workspace.scope.pageIds }),
        },
      },
      t("statistics.synced"),
    );
    if (saved) await model.setFilters({ from, to, channel });
  }
  return {
    provider,
    changeProvider,
    propertyId,
    setPropertyId,
    properties,
    from,
    setFrom,
    to,
    setTo,
    invalidDates,
    submit,
  };
}
