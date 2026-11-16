"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useSeoActionFinding } from "./seo-action-finding";
import { SeoActionDialog } from "./seo-agent-steps";
import type { SeoIssueSeverity } from "./seo-overview-model";
import {
  SEO_ROW_BUTTON_CLASS,
  SEO_ROW_LIST_CLASS,
  SeoSeverity,
  SeoState,
  seoPageLabel,
} from "./seo-shared";
import { type SeoWorkspaceModel, seoActionKey } from "./use-seo-workspace";

/** The filters of the worklist: critical and high issues read as one level, as their orange mark does. */
const FILTERS = ["all", "high", "low", "suggestions"] as const;
type SeoActionFilter = (typeof FILTERS)[number];

function seoActionFilter(
  severity: SeoIssueSeverity | null,
): Exclude<SeoActionFilter, "all"> {
  return severity === null
    ? "suggestions"
    : severity === "minor"
      ? "low"
      : "high";
}

/** The rail of a row has the color of the impact mark; a suggestion has the grey of a quiet line. */
const RAIL: Record<Exclude<SeoActionFilter, "all">, string> = {
  high: "bg-chart-2",
  low: "bg-chart-5",
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
  const opener = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const counts = { all: actions.length, high: 0, low: 0, suggestions: 0 };
  for (const action of actions) counts[seoActionFilter(severity(action))] += 1;
  // A filter that shows every row or none says nothing: the line has only the filters that split the list.
  const filters = FILTERS.filter(
    (key) => key === "all" || (counts[key] > 0 && counts[key] < actions.length),
  );
  // A filter whose rows left (a new check) falls back to all rows.
  const shown = filters.includes(filter) ? filter : "all";
  const rows =
    shown === "all"
      ? actions
      : actions.filter((action) => seoActionFilter(severity(action)) === shown);
  // The dialog holds its action by key: a Task for it changes the action, and the dialog shows the new state.
  const opened = actions.find((action) => seoActionKey(action) === openKey);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2">
        {filters.length > 1 ? (
          <div
            role="group"
            aria-label={t("actions.filter.label")}
            className="bg-muted inline-flex flex-wrap gap-0.5 rounded-lg p-0.5"
          >
            {filters.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={shown === key}
                className={cn(
                  "focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2",
                  shown === key
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setFilter(key)}
              >
                {key === "all" ? null : (
                  <span
                    aria-hidden
                    className={cn("size-1.5 rounded-full", RAIL[key])}
                  />
                )}
                {t(`actions.filter.${key}`)}
                <span className="text-muted-foreground tabular-nums">
                  {counts[key]}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        {tools}
      </div>
      {/* Suggestions alone keep the line that says they are no errors. */}
      {rows.every((action) => severity(action) === null) ? (
        <p className="text-muted-foreground px-2 text-sm">
          {t("actions.opportunitiesHelp")}
        </p>
      ) : null}
      <ul
        ref={list}
        role="list"
        aria-label={t("actions.title")}
        className={SEO_ROW_LIST_CLASS}
      >
        {rows.map((action) => (
          <SeoWorklistRow
            key={seoActionKey(action)}
            action={action}
            severity={severity(action)}
            model={model}
            onOpen={(row) => {
              opener.current = row;
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
          const row = opener.current;
          (row?.isConnected
            ? row
            : list.current?.querySelector<HTMLButtonElement>("button")
          )?.focus();
        }}
      />
    </div>
  );
}

function SeoWorklistRow({
  action,
  severity,
  model,
  onOpen,
}: {
  action: ProjectSeoAction;
  severity: SeoIssueSeverity | null;
  model: SeoWorkspaceModel;
  onOpen: (row: HTMLButtonElement) => void;
}) {
  const t = useTranslations("App.Seo");
  const finding = useSeoActionFinding(action, model);
  return (
    <li>
      <button
        type="button"
        className={cn(SEO_ROW_BUTTON_CLASS, "items-stretch px-3 py-2.5")}
        onClick={(event) => onOpen(event.currentTarget)}
      >
        <span
          aria-hidden
          className={cn(
            "w-1 shrink-0 rounded-full",
            RAIL[seoActionFilter(severity)],
          )}
        />
        <span className="min-w-0 flex-1 gap-3 self-center sm:flex sm:items-center">
          <span className="block min-w-0 sm:flex-1">
            <span className="block text-sm font-medium break-words">
              {action.title}
            </span>
            {/* The page and what the check found, in one quiet line: the dialog has all of it. */}
            <span className="text-muted-foreground block truncate text-xs">
              {seoPageLabel(model.data, action.pageUrl)} · {finding}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 max-sm:mt-1">
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
        <ChevronRight className="text-muted-foreground size-4 shrink-0 self-center" />
      </button>
    </li>
  );
}
