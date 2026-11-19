"use client";

import { Play, Plug, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SeoActionWorklist } from "./seo-action-worklist";
import { SeoBriefPagePriority } from "./seo-brief-summary";
import { SeoExportMenu } from "./seo-export-menu";
import { seoActionsExport } from "./seo-export-model";
import { seoOverviewModel } from "./seo-overview-model";
import { SeoPageDetails } from "./seo-page-details";
import { SeoEmpty, SeoSection } from "./seo-shared";
import { SeoStrategyActions, SeoStrategyPlaceNotes } from "./seo-strategy";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoActions({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const overview = seoOverviewModel(model.data);
  const csv = (
    <SeoExportMenu
      name="actions"
      title={t("actions.title")}
      workspace={model.data}
      table={() => seoActionsExport(overview.actions, t)}
    />
  );
  // The strategy actions are a group with a title of their own: a group over them needs one too.
  const strategyFollows = Boolean(model.data.strategy?.actions.length);
  const searchLoaded = model.data.searchQueries !== null;
  // The recheck rule matters only once a Task exists for an action.
  const tracked = overview.actions.some(
    (action) => action.status !== "recommended",
  );
  // "No recommended actions" above the strategy actions would say two things at once.
  const strategyOnly = !overview.actions.length && strategyFollows;
  if (strategyOnly)
    return (
      <div className="space-y-5">
        <SeoBriefPagePriority model={model} />
        <SeoStrategyActions model={model} />
        <SeoPageDetails model={model} standalone />
        <SeoStrategyPlaceNotes model={model} />
      </div>
    );
  return (
    <div className="space-y-5">
      <SeoBriefPagePriority model={model} />
      <SeoSection
        title={t("actions.listTitle")}
        description={
          tracked
            ? t("actions.help")
            : overview.actions.length
              ? t("actions.listHint")
              : undefined
        }
        // The export stands on the title line, so the list starts with its rows.
        actions={overview.actions.length ? csv : undefined}
        // An empty list says its state in its own title, so the section title would say it twice.
        // An empty list with strategy actions under it returns early above, with the strategy title.
        titleHidden={!overview.actions.length}
      >
        {overview.actions.length ? (
          <SeoActionWorklist
            actions={overview.actions}
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
        <SeoPageDetails model={model} />
      </SeoSection>
      <SeoStrategyActions model={model} afterFixes />
      <SeoStrategyPlaceNotes model={model} />
    </div>
  );
}
