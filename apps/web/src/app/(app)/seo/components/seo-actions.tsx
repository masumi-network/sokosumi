"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { type SeoIssueSeverity, seoOverviewModel } from "./seo-overview-model";
import {
  SeoEmpty,
  SeoPageLink,
  SeoSection,
  SeoSource,
  SeoState,
} from "./seo-shared";
import { SeoStrategyActions } from "./seo-strategy";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * One card for an action on every tab: how bad the issue is, the title, the page
 * and the button. The reasons and the evidence are in its details.
 */
export function SeoActionCard({
  action,
  model,
  severity,
  primary = false,
}: {
  action: ProjectSeoAction;
  model: SeoWorkspaceModel;
  /** The rating of the issue the action fixes; null for a suggestion from search data. */
  severity: SeoIssueSeverity | null;
  /** The page's one filled button. */
  primary?: boolean;
}) {
  const t = useTranslations("App.Seo");
  return (
    <article className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-3 p-4")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold break-words">{action.title}</h3>
        <div className="flex flex-wrap gap-1">
          {/* The severity of the issue it fixes; a suggestion from search data has none. */}
          <SeoState>
            {severity
              ? t(`severity.${severity}`)
              : t(`actions.kind.${action.kind}`)}
          </SeoState>
          {action.status !== "recommended" ? (
            <SeoState>{t(`actions.${action.status}`)}</SeoState>
          ) : null}
        </div>
      </div>
      <SeoPageLink url={action.pageUrl} />
      <details className="text-sm">
        <summary className="focus-visible:ring-ring cursor-pointer rounded-sm py-2.5 font-medium focus-visible:ring-2 focus-visible:outline-none">
          {t("actions.whyDetails")}
        </summary>
        <div className="space-y-3 pt-3">
          <p className="text-muted-foreground text-sm whitespace-pre-wrap break-words">
            {action.why}
          </p>
          <dl className="text-sm">
            <dt className="font-medium">{t("actions.effect")}</dt>
            <dd className="text-muted-foreground mt-1 whitespace-pre-wrap break-words">
              {action.expectedEffect}
            </dd>
          </dl>
          <p className="text-muted-foreground text-xs">
            {t("actions.effort")}: {t(`priority.${action.effort}`)}
          </p>
          {action.evidence.length ? (
            <ul className="text-muted-foreground list-inside list-disc space-y-1 text-xs">
              {action.evidence.map((line, index) => (
                <li key={`${index}:${line}`} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
          <SeoSource
            observationId={action.observationId}
            workspace={model.data}
          />
          {action.edit ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground mb-1 text-xs">
                  {t("actions.before")}
                </p>
                <pre className="bg-quinary overflow-x-auto rounded-md p-3 text-xs whitespace-pre-wrap break-words">
                  {action.edit.before ?? t("actions.noBefore")}
                </pre>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-xs">
                  {t("actions.after")}
                </p>
                <pre className="bg-quinary overflow-x-auto rounded-md p-3 text-xs whitespace-pre-wrap break-words">
                  {action.edit.after}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-3">
        {action.taskId ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/tasks/${encodeURIComponent(action.taskId)}`}>
              {t("openTask")}
            </Link>
          </Button>
        ) : model.data.availableActions.canEdit ? (
          <Button
            size="sm"
            variant={primary ? "primary" : "outline"}
            loading={model.pending}
            onClick={() => {
              void model.createActionTask(action);
            }}
          >
            {t("actions.createTask")}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function ActionGroup({
  title,
  help,
  actions,
  model,
  severity,
}: {
  title: string;
  help: string;
  actions: ProjectSeoAction[];
  model: SeoWorkspaceModel;
  severity: (action: ProjectSeoAction) => SeoIssueSeverity | null;
}) {
  if (!actions.length) return null;
  return (
    <div className="space-y-2">
      <div className="px-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-muted-foreground text-sm">{help}</p>
      </div>
      {actions.map((action) => (
        <SeoActionCard
          key={`${action.observationId}:${action.id}`}
          action={action}
          model={model}
          severity={severity(action)}
        />
      ))}
    </div>
  );
}

export function SeoActions({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const overview = seoOverviewModel(model.data);
  const fixes = overview.actions.filter((action) => action.kind === "fix");
  const opportunities = overview.actions.filter(
    (action) => action.kind === "opportunity",
  );
  const searchLoaded = model.data.searchQueries !== null;
  // The recheck rule matters only once a Task exists for an action.
  const tracked = overview.actions.some(
    (action) => action.status !== "recommended",
  );
  // "No recommended actions" above the strategy actions would say two things at once.
  const strategyOnly =
    !overview.actions.length && Boolean(model.data.strategy?.actions.length);
  if (strategyOnly) return <SeoStrategyActions model={model} />;
  return (
    <div className="space-y-5">
      <SeoSection
        title={t("actions.title")}
        description={tracked ? t("actions.help") : undefined}
      >
        {overview.actions.length ? (
          <div className="space-y-5">
            <ActionGroup
              title={t("actions.fixesTitle")}
              help={t("actions.fixesHelp")}
              actions={fixes}
              model={model}
              severity={overview.actionSeverity}
            />
            <ActionGroup
              title={t("actions.opportunitiesTitle")}
              help={t("actions.opportunitiesHelp")}
              actions={opportunities}
              model={model}
              severity={overview.actionSeverity}
            />
          </div>
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
                {t("addPage")}
              </Button>
            ) : model.data.availableActions.canSyncMetrics &&
              overview.emptyState !== "no_checks" ? (
              <Button
                variant="outline"
                onClick={() => model.setDialog("statistics")}
              >
                {t("overview.manageConnections")}
              </Button>
            ) : model.data.availableActions.canRequestAnalysis ? (
              <Button
                variant="outline"
                onClick={() => model.setDialog("analysis")}
              >
                {t("runAnalysis")}
              </Button>
            ) : null}
          </SeoEmpty>
        )}
      </SeoSection>
      <SeoStrategyActions model={model} />
    </div>
  );
}
