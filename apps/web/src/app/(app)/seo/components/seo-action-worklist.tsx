"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import {
  SEGMENTED_CONTROL_CLASS_NAME,
  SEGMENTED_CONTROL_ITEM_CLASS_NAME,
} from "@/components/ui/segmented-control-classes";
import { useSeoWorklistFocus } from "@/hooks/effects/use-seo-worklist-focus";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import { SeoActionDialog } from "./seo-agent-steps";
import {
  SEO_ACTION_FILTER_LABEL,
  type SeoActionBucket,
  type SeoActionFilter,
  type SeoIssueSeverity,
  seoActionBucket,
  seoActionWorklist,
} from "./seo-overview-model";
import { SeoPropertyPageFacts } from "./seo-property-page-discovery";
import {
  SEO_ROW_ARROW_CLASS,
  SEO_ROW_BUTTON_CLASS,
  SEO_ROW_LIST_CLASS,
  SEO_SEVERITY_MARK_CLASS,
  SeoFoldSummary,
  SeoPageLink,
  SeoSeverity,
  SeoShowMore,
  SeoState,
  seoPageLabel,
  seoPageName,
  seoSiteUrl,
} from "./seo-shared";
import { StrategyActionCard } from "./seo-strategy";
import type { SeoEvidenceAction } from "./seo-worklist-evidence";
import { type SeoWorkspaceModel, seoActionKey } from "./use-seo-workspace";

type WorklistItem = ProjectSeoAction | SeoEvidenceAction;
const VISIBLE_ACTIONS = 6;
const ORDER = { high: 0, low: 2, suggestions: 3 };
const TEST_IDEA_ORDER = 1;

/** The rail of a row has the color of the impact mark; a suggestion has the grey of a quiet line. */
const RAIL: Record<SeoActionBucket, string> = {
  high: SEO_SEVERITY_MARK_CLASS.major,
  low: SEO_SEVERITY_MARK_CLASS.minor,
  suggestions: "bg-border",
};

/**
 * The actions of the Actions tab as one worklist: a filter over slim rows, and a press on a row opens the
 * action in the dialog of the Agent tab, where its reasons and its Task button are.
 */
export function SeoActionWorklist({
  actions,
  evidence = [],
  severity,
  isExperiment = (action) => Boolean(action.decision),
  model,
}: {
  actions: ProjectSeoAction[];
  evidence?: SeoEvidenceAction[];
  isExperiment?: (action: ProjectSeoAction) => boolean;
  severity: (action: ProjectSeoAction) => SeoIssueSeverity | null;
  model: SeoWorkspaceModel;
}) {
  const t = useTranslations("App.Seo");
  const [filter, setFilter] = useState<SeoActionFilter>("all");
  // Counts the reader's filter presses: each brings its rows in anew. A new check that changes the filter keeps
  // the rows, and the focus on one of them.
  const [presses, setPresses] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // The action whose row gets the focus when its dialog closes: the row may be new by then.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [consumedShownAction, setConsumedShownAction] = useState<string | null>(
    null,
  );
  const list = useRef<HTMLUListElement>(null);
  const bucket = (action: WorklistItem) =>
    action.kind === "evidence"
      ? action.bucket
      : seoActionBucket(action, severity(action));
  // An idea with evidence to test stands after the major fixes and before the minor cleanup.
  const order = (action: WorklistItem) =>
    action.kind !== "evidence" &&
    action.status === "recommended" &&
    isExperiment(action) &&
    bucket(action) !== "high"
      ? TEST_IDEA_ORDER
      : ORDER[bucket(action)];
  const ordered = [...actions, ...evidence].sort((a, b) => order(a) - order(b));
  const { counts, filters, rows: rowsFor } = seoActionWorklist(ordered, bucket);
  const [expanded, setExpanded] = useState(false);
  const [led, setLed] = useState(false);
  const { shownStrategy, setShownStrategy } = model;
  if (shownStrategy && !led) {
    setFilter("all");
    setExpanded(true);
    setLed(true);
  }
  const filterLine = useRef<HTMLFieldSetElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // A filter whose rows left (a new check) goes back to all rows, and stays there when they come back.
  if (!filters.includes(filter)) setFilter("all");
  const shown = filters.includes(filter) ? filter : "all";
  useSeoWorklistFocus(
    root,
    filterLine,
    list,
    shownStrategy && led,
    setShownStrategy,
  );
  const rows = rowsFor(shown);
  const firstStrategy = evidence.find((action) => action.strategy);
  // The lead of the Agent tab sent the reader here for one action: the tab mounts the list with all rows, and
  // the action opens in its dialog. One that left the list in the meantime closes at once, below.
  const { shownAction, setShownAction } = model;
  let effectiveOpenKey = openKey;
  if (shownAction && shownAction !== consumedShownAction) {
    setFilter("all");
    setExpanded(true);
    setConsumedShownAction(shownAction);
    setFocusKey(shownAction);
    setOpenKey(shownAction);
    effectiveOpenKey = shownAction;
  } else if (!shownAction && consumedShownAction !== null) {
    setConsumedShownAction(null);
  }
  // The dialog holds its action by key: a Task for it changes the action, and the dialog shows the new state.
  // An action that left the list closes its dialog, and the dialog does not open again when it comes back.
  const opened = actions.find(
    (action) => seoActionKey(action) === effectiveOpenKey,
  );
  if (effectiveOpenKey && !opened) setOpenKey(null);
  return (
    <div ref={root} className="space-y-2">
      {filters.length > 1 ? (
        // One control with its parts: the app's segmented look, buttons with a pressed state.
        // On a phone the parts keep one line and the track scrolls: wrapped, the pills broke into uneven rows.
        // min-w-0: a fieldset is at least as wide as its content by default, and would not scroll.
        <div className="flex px-2">
          <fieldset
            ref={filterLine}
            className={cn(
              SEGMENTED_CONTROL_CLASS_NAME,
              "min-w-0 overflow-x-auto",
            )}
          >
            <legend className="sr-only">{t("actions.filter.label")}</legend>
            {filters.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={shown === key}
                data-state={shown === key ? "on" : "off"}
                // 40 px for a finger on a phone, as the other controls of the workspace.
                className={cn(
                  SEGMENTED_CONTROL_ITEM_CLASS_NAME,
                  "flex-none max-sm:h-10",
                )}
                onClick={() => {
                  if (key === shown) return;
                  setFilter(key);
                  setExpanded(false);
                  setPresses((count) => count + 1);
                }}
              >
                {key === "all" || key === "reviews" ? null : (
                  <span
                    aria-hidden
                    className={cn("size-1.5 rounded-full", RAIL[key])}
                  />
                )}
                {t(SEO_ACTION_FILTER_LABEL[key])}
                <span className="tabular-nums">{counts[key]}</span>
              </button>
            ))}
          </fieldset>
        </div>
      ) : null}
      {/* Suggestions alone keep the line that says they are no errors; the dialog of each one says it too. */}
      {rows.length > 0 &&
      rows.every((action) => action.kind === "opportunity") ? (
        <p className="text-muted-foreground px-2 text-sm">
          {t("actions.opportunitiesHelp")}
        </p>
      ) : null}
      <ul
        // A pressed filter brings its rows in one after the other, as the first paint does.
        key={presses}
        ref={list}
        role="list"
        aria-label={t("actions.title")}
        className={cn(SEO_ROW_LIST_CLASS, "stagger [--stagger-step:30ms]")}
      >
        {(expanded ? rows : rows.slice(0, VISIBLE_ACTIONS)).map((action) =>
          action.kind === "evidence" ? (
            <EvidenceRow
              key={action.key}
              action={action}
              model={model}
              startOpen={
                ordered.length === 1 || (led && action === firstStrategy)
              }
            />
          ) : (
            <SeoWorklistRow
              key={seoActionKey(action)}
              action={action}
              recommendedTest={isExperiment(action)}
              severity={severity(action)}
              rail={RAIL[bucket(action)]}
              model={model}
              onOpen={() => {
                const key = seoActionKey(action);
                setFocusKey(key);
                setOpenKey(key);
                if (shownAction) setShownAction?.(null);
              }}
            />
          ),
        )}
      </ul>
      {rows.length > VISIBLE_ACTIONS && (
        <SeoShowMore
          expanded={expanded}
          more={t("strategy.actions.more", {
            count: rows.length - VISIBLE_ACTIONS,
          })}
          onToggle={() => setExpanded(!expanded)}
        />
      )}
      <SeoActionDialog
        action={opened}
        severity={opened ? severity(opened) : null}
        model={model}
        onClose={() => {
          setOpenKey(null);
          if (shownAction) setShownAction?.(null);
        }}
        onCloseAutoFocus={(event) => {
          // Focus goes back to the row; a row that a new check took away gives it to the first row.
          event.preventDefault();
          const buttons = Array.from(
            list.current?.querySelectorAll<HTMLElement>("button, summary") ??
              [],
          );
          (
            buttons.find((row) => row.dataset.actionKey === focusKey) ??
            buttons[0]
          )?.focus();
        }}
      />
    </div>
  );
}

function SeoWorklistRow({
  action,
  severity,
  recommendedTest,
  rail,
  model,
  onOpen,
}: {
  action: ProjectSeoAction;
  severity: SeoIssueSeverity | null;
  recommendedTest: boolean;
  rail: string;
  model: SeoWorkspaceModel;
  onOpen: () => void;
}) {
  const t = useSeoResultTranslations("App.Seo");
  const page =
    seoPageLabel(model.data, action.pageUrl) ??
    seoPageName(action.pageUrl, seoSiteUrl(model.data), t("pages.home"));
  const titleId = useId();
  const factsId = useId();
  const labelsId = useId();
  return (
    <li>
      <button
        type="button"
        data-action-key={seoActionKey(action)}
        // The title names the row; the page and the finding, then the labels, describe it in the order on screen.
        aria-labelledby={titleId}
        aria-describedby={`${factsId} ${labelsId}`}
        className={cn(SEO_ROW_BUTTON_CLASS, "items-stretch px-3 py-2.5")}
        onClick={onOpen}
      >
        <span
          aria-hidden
          className={cn(
            "w-1 shrink-0 rounded-full forced-colors:bg-[CanvasText]",
            rail,
          )}
        />
        <span className="min-w-0 flex-1 gap-3 self-center sm:flex sm:items-center">
          <span className="block min-w-0 sm:flex-1">
            <span
              id={titleId}
              className="block text-sm font-medium break-words"
            >
              {action.title}
            </span>
            {/* The page and what the check found, in two quiet lines at most: the dialog has all of it. */}
            <span
              id={factsId}
              className="text-muted-foreground line-clamp-2 block text-xs break-words"
            >
              {page}
            </span>
          </span>
          <span
            id={labelsId}
            lang="en"
            className="flex flex-wrap items-center gap-1.5 max-sm:mt-1"
          >
            {recommendedTest && action.status === "recommended" && (
              <SeoState>{t("actions.testRecommendation")}</SeoState>
            )}
            {action.followUpReview && action.status !== "needs_review" && (
              <SeoState>{t("actions.reviewAgain")}</SeoState>
            )}
            {severity ? (
              <SeoSeverity severity={severity} />
            ) : (
              <SeoState>{t(`actions.kind.${action.kind}`)}</SeoState>
            )}
            {/* Once a Task exists its state counts more than the effort. */}
            <SeoState>
              {action.status === "recommended" && action.effort !== "unknown"
                ? `${t("actions.effort")}: ${t(`priority.${action.effort}`)}`
                : t(`actions.${action.status}`)}
            </SeoState>
          </span>
        </span>
        <ChevronRight className={cn(SEO_ROW_ARROW_CLASS, "self-center")} />
      </button>
    </li>
  );
}

function EvidenceRow({
  action,
  model,
  startOpen,
}: {
  action: SeoEvidenceAction;
  model: SeoWorkspaceModel;
  startOpen: boolean;
}) {
  const t = useSeoResultTranslations("App.Seo");
  const place = action.place;
  if (action.strategy)
    return (
      <li data-strategy-row>
        <StrategyActionCard
          title={action.title}
          action={action.strategy}
          model={model}
          startOpen={startOpen}
          page={place?.page}
          meta={
            place &&
            [
              t(`strategy.links.ease.${place.ease}`),
              place.reads && t("strategy.links.reach", place.reads),
            ]
              .filter(Boolean)
              .join(" · ")
          }
          note={place && t(`strategy.links.reason.${place.reason}`)}
        />
      </li>
    );
  return (
    <li lang="en">
      <details>
        <SeoFoldSummary className="min-h-12 gap-3 px-3 py-3 text-sm">
          <span
            aria-hidden
            className={cn(
              "w-1 self-stretch shrink-0 rounded-full",
              RAIL[action.bucket],
            )}
          />
          <span className="min-w-0 flex-1 font-medium break-words">
            {action.title}
          </span>
          <span className="text-xs text-muted-foreground">
            {t(SEO_ACTION_FILTER_LABEL[action.bucket])}
          </span>
        </SeoFoldSummary>
        <div className="space-y-2 ps-7 pe-4 pb-4 text-sm">
          {action.property && <SeoPropertyPageFacts {...action.property} />}
          {action.url && !action.property && <SeoPageLink url={action.url} />}
          {action.facts.map((fact, i) => (
            <p key={i} className="max-w-prose break-words">
              {fact}
            </p>
          ))}
        </div>
      </details>
    </li>
  );
}
