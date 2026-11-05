"use client";
import type { CreateProjectSeoMonitorRequest } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  analysisSeoBody,
  formText,
  SEO_ANALYSIS_MODULES,
  SEO_DEFAULT_MONITOR_RUNS,
  SEO_DEFAULT_PROVIDER_CALLS,
  seoAnalysisRequirements,
  seoMonitorRunCount,
} from "./seo-form-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function useSeoAnalysisForm(model: SeoWorkspaceModel, monitor = false) {
  const t = useTranslations("App.Seo");
  const [workspace] = useState(() => model.data);
  const [modules, setModules] = useState<string[]>(["page.inspect"]);
  const [runCount, setRunCount] = useState(String(SEO_DEFAULT_MONITOR_RUNS));
  const [providerCalls, setProviderCalls] = useState(
    String(SEO_DEFAULT_PROVIDER_CALLS),
  );
  const [timeZone, setTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  function toggleModule(module: string, checked: boolean) {
    if (!SEO_ANALYSIS_MODULES.some((value) => value === module)) return;
    setModules((previous) =>
      checked
        ? [...new Set([...previous, module])]
        : previous.filter((value) => value !== module),
    );
  }
  const [kind, setKind] = useState("page_check");
  async function submit(form: FormData) {
    try {
      const body = analysisSeoBody(form, workspace);
      if (monitor) {
        if (body.kind === "audit_full" || !body.coworkerId)
          throw new Error(
            "Monitoring requires an explicit focused Coworker request",
          );
        const cadence = formText(form, "cadence");
        if (cadence !== "daily" && cadence !== "weekly")
          throw new Error("Invalid cadence");
        const request: Omit<CreateProjectSeoMonitorRequest, "operationId"> = {
          cadence,
          timeZone: formText(form, "timeZone"),
          targetRunCount: seoMonitorRunCount(form),
          analysis: {
            ...body,
            idempotencyKey: model.operationKey(
              `monitor-analysis:${JSON.stringify(body)}`,
            ),
          },
        };
        await model.execute(
          {
            kind: "create_monitor",
            body: {
              ...request,
              operationId: model.operationKey(
                `monitor:${JSON.stringify(request)}`,
              ),
            },
          },
          t("monitor.created"),
        );
        return;
      }
      await model.execute(
        {
          kind: "request_analysis",
          body: {
            ...body,
            idempotencyKey: model.operationKey(
              `analysis:${JSON.stringify(body)}`,
            ),
          },
        },
        t("analysis.queued"),
      );
    } catch (error) {
      toast.error(
        t(
          error instanceof RangeError
            ? "analysis.budgetTooLow"
            : "analysis.invalid",
        ),
      );
    }
  }
  const requirements = seoAnalysisRequirements(kind, modules);
  return {
    kind,
    setKind,
    submit,
    workspace,
    modules,
    toggleModule,
    ...requirements,
    runCount,
    setRunCount,
    providerCalls,
    setProviderCalls,
    timeZone,
    setTimeZone,
    totalProviderCalls:
      Number(runCount) *
      (requirements.usesPaidData ? Number(providerCalls) : 0),
  };
}
