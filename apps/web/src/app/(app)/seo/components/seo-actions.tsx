"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { type SeoIssueSeverity, seoOverviewModel } from "./seo-overview-model";
import {
  SeoEmpty,
  SeoPageLink,
  SeoSection,
  SeoSeverity,
  SeoSource,
  SeoState,
  seoSiteUrl,
} from "./seo-shared";
import { SeoStrategyActions } from "./seo-strategy";
import { type SeoWorkspaceModel, seoActionKey } from "./use-seo-workspace";

/**
 * One card for an action (the Actions tab, and the top proposal on the Agent tab): how bad the issue is,
 * the title, the page and the button. The reasons and the evidence are in its details.
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
  const problem = seoOverviewModel(model.data).actionProblem(action);
  const card = useRef<HTMLElement>(null);
  // "See the fix" on the Health tab and on an Agent row lead here: the card scrolls into view and takes the focus once.
  const shown = model.shownAction === seoActionKey(action);
  const { setShownAction } = model;
  // The card stays marked until the focus leaves the card, so the reader sees which of the cards the row meant.
  const [marked, setMarked] = useState(false);
  useEffect(() => {
    if (!shown) return;
    card.current?.scrollIntoView({ block: "center" });
    card.current?.focus();
    setMarked(true);
    setShownAction(null);
  }, [shown, setShownAction]);
  return (
    <article
      ref={card}
      tabIndex={-1}
      aria-current={marked || undefined}
      onBlur={(event) => {
        // Focus on a control of the card is still on the card.
        if (!event.currentTarget.contains(event.relatedTarget))
          setMarked(false);
      }}
      className={cn(
        HOLDER_ITEM_CLASS,
        "group focus-visible:outline-ring aria-[current=true]:ring-ring min-w-0 space-y-2 p-4 focus-visible:outline-2 aria-[current=true]:ring-2",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold break-words">{action.title}</h3>
        <div className="flex flex-wrap gap-1">
          {/* The severity of the issue it fixes; a suggestion from search data has none. */}
          {severity ? (
            <SeoSeverity severity={severity}>
              {t(`severity.${severity}`)}
            </SeoSeverity>
          ) : (
            <SeoState>{t(`actions.kind.${action.kind}`)}</SeoState>
          )}
          {action.status !== "recommended" ? (
            <SeoState>{t(`actions.${action.status}`)}</SeoState>
          ) : null}
        </div>
      </div>
      {/* In view: what the check found, where an issue is behind the action; the effect of the fix reads like a spec and waits in the details. Two lines, four on a phone; the open details show all of it. */}
      <p className="text-muted-foreground line-clamp-4 text-sm whitespace-pre-wrap break-words group-has-[details[open]]:line-clamp-none sm:line-clamp-2">
        {problem
          ? t("actions.problem", {
              check: t("overview.failedCheck", { name: problem.check }),
              found: problem.found,
            })
          : action.expectedEffect}
        {problem?.footnote ? (
          <span className="hidden group-has-[details[open]]:inline">
            {" "}
            {problem.footnote}
          </span>
        ) : null}
      </p>
      <SeoPageLink url={action.pageUrl} site={seoSiteUrl(model.data)} />
      <details className="text-sm">
        <summary className="focus-visible:ring-ring cursor-pointer rounded-sm py-2.5 font-medium focus-visible:ring-2 focus-visible:outline-none">
          {t("actions.whyDetails")}
        </summary>
        <div className="space-y-3 pt-3">
          <p className="text-muted-foreground text-sm whitespace-pre-wrap break-words">
            {action.why}
          </p>
          {problem ? (
            <p className="text-muted-foreground text-sm whitespace-pre-wrap break-words">
              {t("actions.effect")}: {action.expectedEffect}
            </p>
          ) : null}
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
  primary,
}: {
  title: string;
  help: string;
  actions: ProjectSeoAction[];
  model: SeoWorkspaceModel;
  severity: (action: ProjectSeoAction) => SeoIssueSeverity | null;
  /** The action that carries the tab's one filled button. */
  primary: ProjectSeoAction | undefined;
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
          key={seoActionKey(action)}
          action={action}
          model={model}
          severity={severity(action)}
          primary={action === primary}
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
  // The first action that still waits carries the tab's filled button. Without one, the header's run button has it.
  const primary = [...fixes, ...opportunities].find(
    (action) => action.status === "recommended",
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
              primary={primary}
            />
            <ActionGroup
              title={t("actions.opportunitiesTitle")}
              help={t("actions.opportunitiesHelp")}
              actions={opportunities}
              model={model}
              severity={overview.actionSeverity}
              primary={primary}
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
