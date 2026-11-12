"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import { ArrowUpRight, ClipboardPlus, Play, Plug, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoActionCardHead } from "./seo-card-head";
import { type SeoIssueSeverity, seoOverviewModel } from "./seo-overview-model";
import {
  SEO_ROW_LIST_CLASS,
  SeoActionName,
  SeoEmpty,
  SeoFoldSummary,
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
 * One card for an action (the Actions tab, and the top proposal on the Agent tab). Closed, it is one row:
 * the title, the page and how bad the issue is. Open, it adds what the check found and the button; the
 * reasons and the evidence are in its details. The card with the page's filled button starts open.
 */
export function SeoActionCard({
  action,
  model,
  severity,
  primary = false,
  fixed = false,
}: {
  action: ProjectSeoAction;
  model: SeoWorkspaceModel;
  /** The rating of the issue the action fixes; null for a suggestion from search data. */
  severity: SeoIssueSeverity | null;
  /** The page's one filled button. */
  primary?: boolean;
  /** The card is the one proposal of its place (the Agent tab): it stays open and its title is no button. */
  fixed?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const problem = seoOverviewModel(model.data).actionProblem(action);
  const card = useRef<HTMLElement>(null);
  // "See the fix" on the Health tab and on an Agent row lead here: the card scrolls into view and takes the focus once.
  const shown = model.shownAction === seoActionKey(action);
  const { setShownAction } = model;
  // The card stays marked until the focus leaves the card, so the reader sees which of the cards the row meant.
  const [marked, setMarked] = useState(false);
  // A card that a row leads to is open on its first paint, so it scrolls into view at its full height.
  const [opened, setOpen] = useState(primary || shown);
  const open = fixed || opened;
  const bodyId = useId();
  // The filled button moves on once a Task exists for the card before: the card that gets it opens.
  useEffect(() => {
    if (primary) setOpen(true);
  }, [primary]);
  useEffect(() => {
    if (!shown) return;
    setOpen(true);
    card.current?.scrollIntoView({ block: "center" });
    card.current?.focus();
    setMarked(true);
    setShownAction(null);
  }, [shown, setShownAction]);
  const labels = (
    <>
      {/* The severity of the issue it fixes; a suggestion from search data has none. */}
      {severity ? (
        <SeoSeverity severity={severity} />
      ) : (
        <SeoState>{t(`actions.kind.${action.kind}`)}</SeoState>
      )}
      {action.status !== "recommended" ? (
        <SeoState>{t(`actions.${action.status}`)}</SeoState>
      ) : null}
    </>
  );
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
        "group focus-visible:outline-ring aria-[current=true]:ring-ring min-w-0 focus-visible:outline-2 aria-[current=true]:ring-2",
      )}
    >
      <h3>
        {/* The closed card is one row: the title, its page and how bad the issue is. A press opens what the check found and the button. */}
        <SeoActionCardHead
          bodyId={bodyId}
          open={open}
          onToggle={fixed ? undefined : () => setOpen((value) => !value)}
        >
          <span className="min-w-0 flex-1 gap-3 sm:flex sm:items-center">
            {/* The open card has the link to the page; the closed row names the page. */}
            <SeoActionName
              title={action.title}
              pageUrl={open ? null : action.pageUrl}
              workspace={model.data}
              // A closed row is one step lighter, so the open card and the group titles lead.
              strong={open}
            />
            {/* On a phone the labels of an open card stand under its page link, so the lines keep the order
                of the closed row: title, page, labels. */}
            <span
              className={cn(
                "flex flex-wrap items-center gap-1 max-sm:mt-1",
                open && "max-sm:hidden",
              )}
            >
              {labels}
            </span>
          </span>
        </SeoActionCardHead>
      </h3>
      {open ? (
        <div id={bodyId} className="space-y-2 px-4 pb-4">
          {/* The page stays near the title: the closed row names it there, the open card links it under the
              head. The link is no part of the head: a press on it opens the page, not the card. */}
          <div className="flex">
            <SeoPageLink
              url={action.pageUrl}
              site={seoSiteUrl(model.data)}
              quiet
            />
          </div>
          <span className="flex flex-wrap items-center gap-1 sm:hidden">
            {labels}
          </span>
          {/* What the check found, where an issue is behind the action; the effect of the fix reads like a spec and waits in the details. Two lines, four on a phone; the open details show all of it. */}
          <p className="text-muted-foreground line-clamp-4 text-sm whitespace-pre-wrap break-words group-has-[details[open]]:line-clamp-none sm:line-clamp-2">
            {problem
              ? t("actions.problem", {
                  check: t.markup("overview.failedCheck", {
                    name: problem.check,
                    // Plain words in a running line: the tag is for the Health row title.
                    prefix: (chunks) => chunks,
                  }),
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
          <details className="text-sm">
            {/* Detail behind a fold: quieter than the title and the found line over it. */}
            <SeoFoldSummary className="text-muted-foreground py-2.5">
              {t("actions.whyDetails")}
            </SeoFoldSummary>
            <div className="space-y-3 pt-3">
              {/* What the level means, in words: a hint on the label alone does not reach a phone or a screen reader. */}
              {severity ? (
                <p className="text-muted-foreground text-sm">
                  {t("actions.impactLine", {
                    level: t(`severity.${severity}`),
                    hint: t(`severityHint.${severity}`),
                  })}
                </p>
              ) : null}
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
                <ul className="text-muted-foreground list-disc space-y-1 ps-4 text-xs">
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
          {action.taskId ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/tasks/${encodeURIComponent(action.taskId)}`}>
                <ArrowUpRight />
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
              <ClipboardPlus />
              {t("actions.createTask")}
            </Button>
          ) : null}
        </div>
      ) : null}
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
  named,
}: {
  title: string;
  /** What the group is; absent where the section title says enough. */
  help: string | undefined;
  actions: ProjectSeoAction[];
  model: SeoWorkspaceModel;
  severity: (action: ProjectSeoAction) => SeoIssueSeverity | null;
  /** The action that carries the tab's one filled button. */
  primary: ProjectSeoAction | undefined;
  /** The other group has actions too: only then a group needs its name. */
  named: boolean;
}) {
  if (!actions.length) return null;
  return (
    <div className="space-y-2">
      {named || help ? (
        <div className="px-2">
          {named ? <h3 className="text-sm font-semibold">{title}</h3> : null}
          {help ? (
            <p className="text-muted-foreground text-sm">{help}</p>
          ) : null}
        </div>
      ) : null}
      <ul role="list" className={SEO_ROW_LIST_CLASS}>
        {actions.map((action) => (
          <li key={seoActionKey(action)}>
            <SeoActionCard
              action={action}
              model={model}
              severity={severity(action)}
              primary={action === primary}
            />
          </li>
        ))}
      </ul>
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
  // Two groups on the tab: each one names itself.
  const grouped = fixes.length > 0 && opportunities.length > 0;
  // The strategy actions are a group with a title of their own: a group over them needs one too.
  const strategyFollows = Boolean(model.data.strategy?.actions.length);
  const searchLoaded = model.data.searchQueries !== null;
  // The recheck rule matters only once a Task exists for an action.
  const tracked = overview.actions.some(
    (action) => action.status !== "recommended",
  );
  // "No recommended actions" above the strategy actions would say two things at once.
  const strategyOnly = !overview.actions.length && strategyFollows;
  if (strategyOnly) return <SeoStrategyActions model={model} />;
  return (
    <div className="space-y-5">
      <SeoSection
        title={t("actions.title")}
        description={tracked ? t("actions.help") : undefined}
        titleHidden={!tracked}
      >
        {overview.actions.length ? (
          <div className="space-y-5">
            <ActionGroup
              title={t("actions.fixesTitle")}
              // Alone under "Actions", a list of fixes needs no line; suggestions keep theirs: it says they promise no traffic.
              help={grouped ? t("actions.fixesHelp") : undefined}
              actions={fixes}
              model={model}
              severity={overview.actionSeverity}
              primary={primary}
              named={grouped || strategyFollows}
            />
            <ActionGroup
              title={t("actions.opportunitiesTitle")}
              help={t("actions.opportunitiesHelp")}
              actions={opportunities}
              model={model}
              severity={overview.actionSeverity}
              primary={primary}
              named={grouped || strategyFollows}
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
      </SeoSection>
      <SeoStrategyActions model={model} afterFixes />
    </div>
  );
}
