"use client";
import type { CreateProjectSeoMonitorRequest } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  type SearchConsoleWarning,
  seoSearchConsoleWarning,
} from "@/lib/seo/search-console-warning";
import { briefForReview, selectedBriefPages } from "./seo-brief-model";
import {
  allowedSeoAnalysisKinds,
  analysisSeoBody,
  formLines,
  SEO_ANALYSIS_MODULES,
  SEO_DEVICES,
  type SeoDevice,
  seoAnalysisRequirements,
  seoProviderCallsNeeded,
} from "./seo-form-model";
import {
  seoMonitorRuleOf,
  seoMonitorTooOften,
  seoMonitorWhen,
} from "./seo-monitor-model";
import { seoCheckBlocking, seoRunAction } from "./seo-setup-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function useSeoAnalysisForm(model: SeoWorkspaceModel, monitor = false) {
  const t = useTranslations("App.Seo");
  const [workspace] = useState(() => model.data);
  const [chosenModules, setModules] = useState<string[]>(["page.inspect"]);
  const canUsePaidSearchData =
    model.data.availableActions.canUsePaidSearchData === true;
  const kinds = allowedSeoAnalysisKinds(canUsePaidSearchData);
  const modules = canUsePaidSearchData ? chosenModules : ["page.inspect"];
  const [competitorUrls, setCompetitorUrls] = useState(() =>
    workspace.competitors
      .filter((row) => row.confirmed)
      .map((row) => row.url)
      .join("\n"),
  );
  // A new monitor starts weekly on Mondays at 09:00 in the reader's time zone.
  const [when, setWhen] = useState(() =>
    seoMonitorWhen(null, Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  const rule = seoMonitorRuleOf(when);
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
  // The check and the schedule start on their defaults: the fields show when the reader asks, or when a value is
  // refused. A schedule decides only when it runs.
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [devices, setDevices] = useState<readonly SeoDevice[]>(SEO_DEVICES);
  function toggleDevice(device: SeoDevice, checked: boolean) {
    setDevices((previous) =>
      SEO_DEVICES.filter((value) =>
        value === device ? checked : previous.includes(value),
      ),
    );
  }
  const kind = kinds.find((value) => value === chosenKind) ?? "page_check";
  const choice =
    !monitor && (kind === "audit_full" || kind === "page_check")
      ? model.reviewGoal
      : null;
  const brief = model.brief?.data;
  const staleGoal = Boolean(
    choice &&
      choice.revision !== brief?.revision &&
      (choice.changed || (kind === "audit_full" && choice.share)),
  );
  const reviewGoal =
    choice && choice.revision === brief?.revision ? choice : null;
  const reviewBrief = briefForReview(brief, reviewGoal);
  const serviceAvailable = monitor
    ? model.data.availableActions.canCreateMonitor === true
    : model.data.availableActions.canRequestAnalysis;
  const [warning, setWarning] = useState<{
    operationId: string;
    reason: SearchConsoleWarning;
  } | null>(null);
  const selectingProperty =
    kind === "audit_full" && model.statisticsSync?.selectingSearchProperty;
  async function submit(form: FormData, allowLimited = false) {
    if (staleGoal || (selectingProperty && !allowLimited)) return;
    if (!serviceAvailable) {
      toast.error(
        t(monitor ? "monitor.unavailable" : "analysis.serviceUnavailable"),
      );
      return;
    }
    // A check can start in another window while this form is open.
    if (!monitor && seoCheckBlocking(model.data, new Date())) {
      toast.info(t("analysis.alreadyRunning"));
      return;
    }
    try {
      const body = analysisSeoBody(form, {
        ...workspace,
        availableActions: model.data.availableActions,
      });
      const sharedBrief =
        !monitor && kind === "audit_full"
          ? selectedBriefPages(form, reviewBrief, workspace.scope.pageIds)
          : undefined;
      const request = {
        ...body,
        ...(reviewGoal?.changed && {
          setupGoal: {
            pageId: reviewGoal.pageId,
            expectedRevision: reviewGoal.revision,
            action: reviewGoal.action,
          },
        }),
        ...(sharedBrief && { sharedBrief }),
      };
      const includeSitemaps =
        kind === "audit_full" && form.get("includeSitemaps") === "on";
      const includePropertyTotals =
        kind === "audit_full" && form.get("includePropertyTotals") === "on";
      const scope = model.setupScopeKey;
      const analysisKey = model.operationKey(
        JSON.stringify([
          monitor ? "monitor-analysis" : "analysis",
          scope,
          request,
          ...(includePropertyTotals
            ? ["includePropertyTotals", "includePageDiscovery"]
            : []),
          ...(includeSitemaps ? ["includeSitemaps"] : []),
        ]),
      );
      const operationId = monitor
        ? model.operationKey(JSON.stringify(["monitor", rule, analysisKey]))
        : analysisKey;
      const handleRefusal = (kind: string | undefined) => {
        const reason = seoSearchConsoleWarning(kind);
        if (!reason) return false;
        setWarning({ operationId, reason });
        return true;
      };
      const property = model.statisticsSync?.searchConsolePropertyId;
      const analysis = {
        ...request,
        idempotencyKey: analysisKey,
        ...(!allowLimited &&
          includePropertyTotals && {
            includePropertyTotals: true as const,
            includePageDiscovery: true as const,
          }),
        ...(!allowLimited &&
          includeSitemaps && { includeSitemaps: true as const }),
        ...(kind === "audit_full" &&
          property && { searchConsolePropertyId: property }),
        ...(kind === "audit_full" &&
          allowLimited &&
          warning?.operationId === operationId && {
            allowLimitedAudit: true as const,
          }),
      };
      setWarning(null);
      if (monitor) {
        if (!rule) throw new Error("Invalid SEO monitor rule");
        const body: CreateProjectSeoMonitorRequest = {
          rule,
          analysis,
          operationId,
        };
        await model.execute(
          { kind: "create_monitor", body },
          t("monitor.created"),
          handleRefusal,
        );
      } else {
        await model.execute(
          { kind: "request_analysis", body: analysis },
          t("analysis.queued"),
          handleRefusal,
        );
      }
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
    reviewBrief,
    reviewGoal,
    staleGoal,
    warning: warning?.reason,
    kinds,
    serviceAvailable,
    selectingProperty,
    canUsePaidSearchData,
    setKind,
    submit,
    workspace,
    modules,
    toggleModule,
    ...requirements,
    when,
    setWhen,
    rule,
    tooOften: seoMonitorTooOften(when),
    competitorUrls,
    setCompetitorUrls,
    optionsOpen,
    setOptionsOpen,
    devices,
    toggleDevice,
    /** The data requests of one run of these keywords: a monitor that runs until stopped has no total. */
    providerCallsFor: (keywords: string) =>
      seoProviderCallsNeeded(
        requirements,
        formLines(keywords).length,
        devices.length,
        workspace.scope.pageIds.length,
        formLines(competitorUrls).length,
      ),
  };
}
