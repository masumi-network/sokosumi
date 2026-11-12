"use client";
import type { CreateProjectSeoMonitorRequest } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  allowedSeoAnalysisKinds,
  analysisSeoBody,
  defaultFullAuditSeconds,
  formText,
  SEO_ANALYSIS_MODULES,
  SEO_DEFAULT_FULL_AUDIT_USD,
  SEO_DEFAULT_MONITOR_RUNS,
  SEO_DEFAULT_PROVIDER_CALLS,
  SEO_DEVICES,
  type SeoDevice,
  seoAnalysisRequirements,
  seoMonitorRunCount,
} from "./seo-form-model";
import { seoCheckRunning, seoRunAction } from "./seo-setup-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function useSeoAnalysisForm(model: SeoWorkspaceModel, monitor = false) {
  const t = useTranslations("App.Seo");
  const [workspace] = useState(() => model.data);
  const [chosenModules, setModules] = useState<string[]>(["page.inspect"]);
  const canUsePaidSearchData =
    model.data.availableActions.canUsePaidSearchData === true;
  const kinds = allowedSeoAnalysisKinds(canUsePaidSearchData, monitor);
  const modules = canUsePaidSearchData ? chosenModules : ["page.inspect"];
  const [runCount, setRunCount] = useState(String(SEO_DEFAULT_MONITOR_RUNS));
  const [providerCalls, setProviderCalls] = useState(
    String(SEO_DEFAULT_PROVIDER_CALLS),
  );
  const [timeZone, setTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  function toggleModule(module: string, checked: boolean) {
    if (!canUsePaidSearchData) return;
    if (!SEO_ANALYSIS_MODULES.some((value) => value === module)) return;
    setModules((previous) =>
      checked
        ? [...new Set([...previous, module])]
        : previous.filter((value) => value !== module),
    );
  }
  // Every opener gets the widest check these pages allow, unless it names one.
  const [chosenKind, setKind] = useState<string>(
    () => model.analysisKind ?? seoRunAction(model.data)?.kind ?? "page_check",
  );
  // The check starts on its defaults: the fields show when the reader asks, or when a value is refused.
  // A schedule has more to decide, so its fields are open.
  const [optionsOpen, setOptionsOpen] = useState(monitor);
  const [devices, setDevices] = useState<readonly SeoDevice[]>(SEO_DEVICES);
  const [usd, setUsd] = useState(String(SEO_DEFAULT_FULL_AUDIT_USD));
  const [seconds, setSeconds] = useState(() =>
    String(defaultFullAuditSeconds(model.data.scope.pageIds.length)),
  );
  function toggleDevice(device: SeoDevice, checked: boolean) {
    setDevices((previous) =>
      SEO_DEVICES.filter((value) =>
        value === device ? checked : previous.includes(value),
      ),
    );
  }
  const kind = kinds.find((value) => value === chosenKind) ?? "page_check";
  const serviceAvailable = monitor
    ? model.data.availableActions.canCreateMonitor === true
    : model.data.availableActions.canRequestAnalysis;
  async function submit(form: FormData) {
    if (!serviceAvailable) {
      toast.error(
        t(monitor ? "monitor.unavailable" : "analysis.serviceUnavailable"),
      );
      return;
    }
    // A check can start in another window while this form is open.
    if (!monitor && seoCheckRunning(model.data)) {
      toast.info(t("analysis.alreadyRunning"));
      return;
    }
    try {
      const body = analysisSeoBody(form, {
        ...workspace,
        availableActions: model.data.availableActions,
      });
      if (monitor) {
        if (body.kind === "audit_full")
          throw new Error("Monitoring supports focused checks only");
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
      // The refused value is in a field: show the fields with the message.
      setOptionsOpen(true);
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
    kinds,
    serviceAvailable,
    canUsePaidSearchData,
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
    optionsOpen,
    setOptionsOpen,
    devices,
    toggleDevice,
    usd,
    setUsd,
    seconds,
    setSeconds,
    totalProviderCalls:
      Number(runCount) *
      (requirements.usesPaidData ? Number(providerCalls) : 0),
  };
}
