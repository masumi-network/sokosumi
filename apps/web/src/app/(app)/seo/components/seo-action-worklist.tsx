"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  SEGMENTED_CONTROL_CLASS_NAME,
  SEGMENTED_CONTROL_ITEM_CLASS_NAME,
} from "@/components/ui/segmented-control-classes";
import { cn } from "@/lib/utils";
import { useSeoActionFinding } from "./seo-action-finding";
import { SeoActionDialog } from "./seo-agent-steps";
import {
  SEO_ACTION_FILTER_LABEL,
  type SeoActionBucket,
  type SeoActionFilter,
  type SeoIssueSeverity,
  seoActionBucket,
  seoActionWorklist,
} from "./seo-overview-model";
import {
  SEO_ROW_ARROW_CLASS,
  SEO_ROW_BUTTON_CLASS,
  SEO_ROW_LIST_CLASS,
  SEO_SEVERITY_MARK_CLASS,
  SeoSeverity,
  SeoState,
  seoPageLabel,
} from "./seo-shared";
import { type SeoWorkspaceModel, seoActionKey } from "./use-seo-workspace";

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
  severity,
  model,
  tools,
}: {
  actions: ProjectSeoAction[];
  severity: (action: ProjectSeoAction) => SeoIssueSeverity | null;
  model: SeoWorkspaceModel;
  /** A control at the end of the filter line, such as the export. */
  tools: ReactNode;
}) {
  const t = useTranslations("App.Seo");
  const [filter, setFilter] = useState<SeoActionFilter>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);
  // The action whose row gets the focus when its dialog closes: the row may be new by then.
  const focusKey = useRef<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const bucket = (action: ProjectSeoAction) =>
    seoActionBucket(action, severity(action));
  const { counts, filters, rows: rowsFor } = seoActionWorklist(actions, bucket);
  const filterLine = useRef<HTMLFieldSetElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Read in each render, before its commit: a new check can take away the filter, the row or the whole filter
  // line that has the focus.
  const hadFocus = useRef(false);
  hadFocus.current = Boolean(root.current?.contains(document.activeElement));
  // A filter whose rows left (a new check) goes back to all rows, and stays there when they come back.
  if (!filters.includes(filter)) setFilter("all");
  const shown = filters.includes(filter) ? filter : "all";
  // A focus that left with its control goes to All, or to the first row when the filter line left too.
  useEffect(() => {
    if (!hadFocus.current || document.activeElement !== document.body) return;
    hadFocus.current = false;
    (
      filterLine.current?.querySelector<HTMLButtonElement>("button") ??
      list.current?.querySelector<HTMLButtonElement>("button")
    )?.focus();
  });
  const rows = rowsFor(shown);
  // The lead of the Agent tab sent the reader here for one action: the tab mounts the list with all rows, and
  // the action opens in its dialog. One that left the list in the meantime closes at once, below.
  const { shownAction, setShownAction } = model;
  useEffect(() => {
    if (!shownAction) return;
    setShownAction(null);
    focusKey.current = shownAction;
    setOpenKey(shownAction);
  }, [shownAction, setShownAction]);
  // The dialog holds its action by key: a Task for it changes the action, and the dialog shows the new state.
  // An action that left the list closes its dialog, and the dialog does not open again when it comes back.
  const opened = actions.find((action) => seoActionKey(action) === openKey);
  if (openKey && !opened) setOpenKey(null);
  return (
    <div ref={root} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 px-2">
        {filters.length > 1 ? (
          // One control with its parts: the app's segmented look, buttons with a pressed state.
          // On a phone the parts keep one line and the track scrolls: wrapped, the pills broke into uneven rows.
          // min-w-0: a fieldset is at least as wide as its content by default, and would not scroll.
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
                onClick={() => setFilter(key)}
              >
                {key === "all" ? null : (
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
        ) : null}
        <div className="ms-auto">{tools}</div>
      </div>
      {/* Suggestions alone keep the line that says they are no errors; the dialog of each one says it too. */}
      {rows.length > 0 &&
      rows.every((action) => action.kind === "opportunity") ? (
        <p className="text-muted-foreground px-2 text-sm">
          {t("actions.opportunitiesHelp")}
        </p>
      ) : null}
      <ul
        // A new filter brings its rows in one after the other, as the first paint does.
        key={shown}
        ref={list}
        role="list"
        aria-label={t("actions.title")}
        className={cn(SEO_ROW_LIST_CLASS, "stagger [--stagger-step:30ms]")}
      >
        {rows.map((action) => (
          <SeoWorklistRow
            key={seoActionKey(action)}
            action={action}
            severity={severity(action)}
            rail={RAIL[bucket(action)]}
            model={model}
            onOpen={() => {
              focusKey.current = seoActionKey(action);
              setOpenKey(seoActionKey(action));
            }}
          />
        ))}
      </ul>
      <SeoActionDialog
        action={opened}
        severity={opened ? severity(opened) : null}
        model={model}
        onClose={() => setOpenKey(null)}
        onCloseAutoFocus={(event) => {
          // Focus goes back to the row; a row that a new check took away gives it to the first row.
          event.preventDefault();
          const buttons = Array.from(
            list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
          );
          (
            buttons.find((row) => row.dataset.actionKey === focusKey.current) ??
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
  rail,
  model,
  onOpen,
}: {
  action: ProjectSeoAction;
  severity: SeoIssueSeverity | null;
  rail: string;
  model: SeoWorkspaceModel;
  onOpen: () => void;
}) {
  const t = useTranslations("App.Seo");
  const finding = useSeoActionFinding(action, model);
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
              {seoPageLabel(model.data, action.pageUrl)} · {finding}
            </span>
          </span>
          <span
            id={labelsId}
            className="flex flex-wrap items-center gap-1.5 max-sm:mt-1"
          >
            {severity ? (
              <SeoSeverity severity={severity} />
            ) : (
              <SeoState>{t(`actions.kind.${action.kind}`)}</SeoState>
            )}
            {/* Once a Task exists its state counts more than the effort. */}
            <SeoState>
              {action.status === "recommended"
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
