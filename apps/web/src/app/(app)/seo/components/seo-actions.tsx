"use client";

import { Play, Plug, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoActionWorklist } from "./seo-action-worklist";
import { SeoArticleDates } from "./seo-article-dates";
import {
  currentDiscoveryResult,
  SeoCurrentDiscoveryActions,
} from "./seo-audit-discovery";
import { SeoAuditResearch } from "./seo-audit-research";
import { SeoExportMenu } from "./seo-export-menu";
import { seoActionsExport } from "./seo-export-model";
import { SeoIndexStatus } from "./seo-index-status";
import { seoOverviewModel } from "./seo-overview-model";
import { SeoPageDetails } from "./seo-page-details";
import { SeoEmpty, SeoFoldSummary, SeoSection } from "./seo-shared";
import { SeoStrategicPlanning } from "./seo-strategic-planning";
import { SeoSummaryTiles } from "./seo-summary-tiles";
import { seoWorklistEvidence } from "./seo-worklist-evidence";

import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoActions({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const overview = seoOverviewModel(model.data);
  const result = useSeoResultTranslations("App.Seo");
  const searchLoaded = model.data.searchQueries !== null;
  // The recheck rule matters only once a Task exists for an action.
  const tracked = overview.actions.some((action) => Boolean(action.taskId));
  // "No recommended actions" above the strategy actions would say two things at once.
  const searchResult = currentDiscoveryResult(
    model.data,
    Boolean(model.filters.pageId || model.filters.scopeId),
  );
  const evidence = seoWorklistEvidence(
    model.data,
    searchResult,
    overview.actions,
    result,
  );
  const hasCheckDetails = Boolean(
    model.data.observations.length > 0 ||
      model.data.indexStatus?.pages.length ||
      model.data.indexTriage?.assessments.length,
  );
  const hasActions = overview.actions.length > 0 || evidence.length > 0;
  const csv = (
    <SeoExportMenu
      name="actions"
      showTitle={evidence.length > 0}
      titleKey={evidence.length ? "planning.savedActions" : "actions.title"}
      workspace={model.data}
      table={(report) => seoActionsExport(overview.actions, report)}
    />
  );
  const research = (
    <SeoAuditResearch
      workspace={model.data}
      discovery={searchResult?.discovery}
    />
  );
  return (
    <div className="space-y-5">
      <SeoSection
        title={t("actions.listTitle")}
        description={tracked ? t("actions.help") : undefined}
        // The export stands on the title line, so the list starts with its rows.
        actions={overview.actions.length ? csv : undefined}
        // An empty list says its state in its own title, so the section title would say it twice.
        // An empty list with strategy actions under it returns early above, with the strategy title.
        titleHidden={
          !hasActions && !hasCheckDetails && !overview.diagnostics.length
        }
      >
        {hasActions ? (
          <SeoActionWorklist
            actions={overview.actions}
            evidence={evidence}
            severity={overview.actionSeverity}
            model={model}
          />
        ) : (
          <SeoEmpty
            title={t(
              overview.emptyState === "no_fixes"
                ? "actions.noFixes"
                : overview.emptyState === "incomplete"
                  ? "actions.checksIncomplete"
                  : overview.emptyState === "issues"
                    ? "actions.unplannedIssues"
                    : "actions.empty",
            )}
            body={t(
              overview.emptyState === "incomplete"
                ? "actions.checksIncompleteBody"
                : overview.emptyState === "issues"
                  ? "actions.unplannedIssuesBody"
                  : overview.emptyState !== "no_fixes"
                    ? model.data.availableActions.canRequestAnalysis
                      ? "actions.emptyBody"
                      : "actions.emptyBodyOff"
                    : searchLoaded
                      ? "actions.noOpportunitiesBody"
                      : "actions.noFixesBody",
            )}
          >
            {/* The header already offers "Ask the SEO agent"; the empty state offers the next concrete step. */}
            {overview.emptyState === "issues" ? null : overview.emptyState ===
                "no_fixes" &&
              searchLoaded &&
              model.data.availableActions.canEdit ? (
              <Button variant="outline" onClick={() => model.setDialog("page")}>
                <Plus />
                {t("addPage")}
              </Button>
            ) : model.data.availableActions.canSyncMetrics &&
              overview.emptyState !== "no_checks" ? (
              <Button
                variant="outline"
                onClick={() => model.setDialog("statistics")}
              >
                <Plug />
                {t("overview.manageConnections")}
              </Button>
            ) : model.data.availableActions.canRequestAnalysis ? (
              <Button
                variant="outline"
                onClick={() => model.setDialog("analysis")}
              >
                <Play />
                {t("runAnalysis")}
              </Button>
            ) : null}
          </SeoEmpty>
        )}
        {/* The page details are what the checks measured on the pages: they close the list of what to do. */}
        {hasCheckDetails ? (
          <details className={HOLDER_ITEM_CLASS}>
            <SeoFoldSummary className="min-h-11 justify-between px-4 py-2 text-sm font-medium">
              {t("actions.checkDetails")}
            </SeoFoldSummary>
            <div className="min-w-0 space-y-5 border-t p-3 sm:p-4">
              <SeoSummaryTiles workspace={model.data} filters={model.filters} />
              <SeoIndexStatus workspace={model.data} />
            </div>
          </details>
        ) : null}
        <SeoPageDetails model={model} overview={overview} />
      </SeoSection>
      {research}
      <SeoStrategicPlanning model={model} />
      <SeoCurrentDiscoveryActions
        workspace={model.data}
        result={searchResult}
      />
      <SeoArticleDates workspace={model.data} />
    </div>
  );
}
