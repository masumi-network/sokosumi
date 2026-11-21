"use client";

import { useState } from "react";
import { seoPlanReports, seoReportPlan } from "./seo-report-plan-model";
import { useSeasonalClock } from "./seo-seasonal-ideas-model";
import { type SeoWorkspaceModel, seoActionKey } from "./use-seo-workspace";

export function useSelectedSeoPlan(model: SeoWorkspaceModel) {
  const [picked, setPicked] = useState<string | null>(null);
  const reports = seoPlanReports(model.data);
  const now = useSeasonalClock(
    reports.some((report) => report.planCandidates?.some((row) => row.season)),
  );
  const report = reports.find((row) => row.id === picked) ?? reports[0];

  const historical =
    report?.id !== reports[0]?.id ||
    Boolean(
      model.filters.to && model.filters.to < now.toISOString().slice(0, 10),
    );
  const plan = report
    ? seoReportPlan(model.data, report, model.brief?.data, historical, now)
    : null;
  const actionKeys = new Set<string>();
  if (plan && !historical) {
    const include = (origin: string | undefined, id: string | undefined) => {
      if (origin && id)
        actionKeys.add(seoActionKey({ observationId: origin, id }));
    };
    if (!plan.reconsider) include(plan.originId, plan.lead.actionId);
    include(plan.followOrigin, plan.follow?.actionId);
    for (const row of plan.more) include(row.originId, row.item.actionId);
  }
  return { report, reports, plan, setPicked, historical, actionKeys };
}
