"use client";

import { CalendarRange } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { PerformanceDateRange } from "@/components/performance/performance-date-range";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SeoSelect } from "./seo-form-fields";
import {
  SEO_DATE_PRESET_DAYS,
  seoCheckPeriod,
  seoDatePreset,
} from "./seo-statistics-model";
import { seoTrafficChannel } from "./seo-traffic-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** The tabs that dates narrow, and what each one needs before a date has anything to narrow. */
const DATED_TABS: Partial<
  Record<
    SeoWorkspaceModel["filters"]["tab"],
    (data: SeoWorkspaceModel["data"]) => boolean
  >
> = {
  traffic: (data) => data.metrics.length > 0,
  // One check has one date: a date filter can only show it or hide it. Search statistics span many days.
  rankings: (data) =>
    (data.keywords.length > 0 || data.competitors.length > 0) &&
    (data.observations.length > 1 || data.metrics.length > 0),
  // Statistics syncs alone give the filter nothing worth a control: a routine one is no timeline row, and failures fold into one.
  actions: (data) =>
    data.timeline.filter((event) => event.kind !== "metrics").length > 1,
};

/**
 * Which filters offer a real choice. With one page, that page is the same as all pages,
 * so the picker shows only for a saved selection or a page the Audit no longer has.
 * Search Console is organic only; the traffic choice matters once Google Analytics data
 * exists, and a chosen channel always shows so it can be cleared.
 */
export function seoScopeControls({
  data,
  filters,
}: Pick<SeoWorkspaceModel, "data" | "filters">) {
  const knownPage =
    !filters.pageId || data.pages.some((page) => page.id === filters.pageId);
  return {
    pages:
      data.pages.length > 1 ||
      data.scopes.length > 0 ||
      Boolean(filters.scopeId) ||
      !knownPage,
    channel:
      Boolean(filters.channel) ||
      data.metrics.some((metric) => metric.source === "ga4"),
    // Dates narrow measured traffic, rankings and checks (the issues and history on Actions); the agent's brief stays current.
    // A chosen date always shows, so it can be cleared.
    dates:
      DATED_TABS[filters.tab]?.(data) === true ||
      Boolean(filters.from || filters.to),
  };
}

/** Dates narrow every check and finding shown; they stay folded until someone asks. */
export function useSeoDateFields({
  filters,
  dates,
  picked,
}: {
  filters: SeoWorkspaceModel["filters"];
  dates: boolean;
  /** The end date is the pick of a run in the row of runs: that row shows it, so the fields stay closed. */
  picked: boolean;
}) {
  // The tab the fields were opened on: fields opened elsewhere fold where dates are hidden,
  // but fields in use there stay while a date is cleared mid-edit.
  const [openedOn, setOpenedOn] = useState<{ tab: typeof filters.tab } | null>(
    (filters.from || filters.to) && !picked ? { tab: filters.tab } : null,
  );
  return {
    // An active date filter always shows, also when a link or Back sets it later.
    open:
      Boolean(openedOn && (dates || openedOn.tab === filters.tab)) ||
      (Boolean(filters.from || filters.to) && !picked),
    reveal: () => setOpenedOn({ tab: filters.tab }),
  };
}

/**
 * The pages in view, as the line under the Audit's name: "All 2 pages" is the
 * count and the filter in one control. A labelled row of its own stood over
 * every tab for a choice most Audits never change.
 */
export function SeoPagePicker({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const { data, filters, setFilters } = model;
  const selected = filters.scopeId
    ? `scope:${filters.scopeId}`
    : filters.pageId
      ? `page:${filters.pageId}`
      : "all";
  return (
    <Select
      value={selected}
      onValueChange={(value) => {
        const [kind, id] = value.split(":");
        void setFilters({
          scopeId: kind === "scope" ? id : null,
          pageId: kind === "page" ? id : null,
        });
      }}
    >
      <SelectTrigger
        aria-label={t("scope")}
        // Quiet: text and an arrow, no box. 40 px high on a phone for the finger.
        className="text-muted-foreground hover:text-foreground -my-1 max-w-full gap-1 border-0 px-0 py-0 text-sm! data-[size=default]:h-10 sm:data-[size=default]:h-7 dark:bg-transparent dark:hover:bg-transparent *:data-[slot=select-value]:block! *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">
          {t("allPagesCount", { count: data.pages.length })}
        </SelectItem>
        {data.scopes.map((scope) => (
          <SelectItem key={scope.id} value={`scope:${scope.id}`}>
            {scope.name}
          </SelectItem>
        ))}
        {data.pages.map((page) => (
          <SelectItem key={page.id} value={`page:${page.id}`}>
            <bdi>{page.label || page.url}</bdi>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Opens the date fields and moves focus to the first one: the control that opened them unmounts or stays put. */
export function seoRevealDates(
  dateFields: ReturnType<typeof useSeoDateFields>,
) {
  dateFields.reveal();
  requestAnimationFrame(() =>
    document.getElementById("seo-period-from")?.focus(),
  );
}

/**
 * The closed date filter: quiet words, no outline. It stands in the header line beside the page picker, or in
 * the filter block where the header has no picker. An outlined button in a row of its own stood over every
 * dated tab for a choice most readers never make.
 */
export function SeoDateFilterButton({
  dateFields,
  onReveal,
  className,
}: {
  dateFields: ReturnType<typeof useSeoDateFields>;
  /** In the header the button stands outside the filter block, which can be folded: the caller opens it. */
  onReveal?: () => void;
  className?: string;
}) {
  const t = useTranslations("App.Seo");
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-expanded={false}
      // Quiet as the page picker beside it: text and an icon, no box.
      className={cn(
        "text-muted-foreground hover:text-foreground -my-1 h-7 gap-1 px-0 font-normal hover:bg-transparent has-[>svg]:px-0 dark:hover:bg-transparent",
        className,
      )}
      onClick={() => {
        seoRevealDates(dateFields);
        onReveal?.();
      }}
    >
      <CalendarRange className="size-4" />
      <span>{t("filterDates")}</span>
    </Button>
  );
}

/** The open date filter: the first and last day, and why they cannot narrow the view. */
export function SeoDateFields({
  model,
  dateFields,
}: {
  model: SeoWorkspaceModel;
  dateFields: ReturnType<typeof useSeoDateFields>;
}) {
  const t = useTranslations("App.Seo");
  const { filters, setFilters } = model;
  const preset = seoDatePreset(filters);
  // Core does not narrow saved traffic statistics by date, so a quick period there would change nothing.
  const presets = filters.tab !== "traffic";
  return (
    <>
      {presets ? (
        <div
          role="group"
          aria-label={t("datePresets.label")}
          className="flex flex-wrap gap-1"
        >
          {SEO_DATE_PRESET_DAYS.map((days) => (
            <Button
              key={days}
              size="sm"
              variant={preset === days ? "secondary" : "ghost"}
              aria-pressed={preset === days}
              onClick={() => {
                dateFields.reveal();
                void setFilters(seoCheckPeriod(days));
              }}
            >
              {t("datePresets.days", { count: days })}
            </Button>
          ))}
        </div>
      ) : null}
      <PerformanceDateRange
        idPrefix="seo-period"
        from={filters.from ?? ""}
        until={filters.to ?? ""}
        fromLabel={t("dateFrom")}
        untilLabel={t("dateTo")}
        invalid={model.invalidDates}
        onFromChange={(from) => {
          dateFields.reveal();
          void setFilters({ from: from || null });
        }}
        onUntilChange={(to) => {
          dateFields.reveal();
          void setFilters({ to: to || null });
        }}
      />
      {model.invalidDates ? (
        <p role="alert" className="text-destructive w-full text-sm">
          {t("invalidDates")}
        </p>
      ) : null}
    </>
  );
}

export function SeoScopeBar({
  model,
  dateFields,
  dateButton,
  dates,
}: {
  model: SeoWorkspaceModel;
  dateFields: ReturnType<typeof useSeoDateFields>;
  /** False where the header line holds the closed date filter. */
  dateButton: boolean;
  /** False where the row of runs holds the date filter. */
  dates: boolean;
}) {
  const t = useTranslations("App.Seo");
  const { filters, setFilters } = model;
  const controls = seoScopeControls(model);
  return (
    <div className="flex flex-wrap items-end gap-3 empty:hidden">
      {controls.channel ? (
        <div className="min-w-48 space-y-2">
          <Label htmlFor="seo-channel">{t("statistics.channel")}</Label>
          <SeoSelect
            id="seo-channel"
            value={filters.channel ?? "any"}
            onValueChange={(value) => {
              void setFilters({
                channel: seoTrafficChannel(value),
              });
            }}
            options={[
              { value: "any", label: t("statistics.channelAny") },
              { value: "all", label: t("statistics.channelAll") },
              { value: "organic", label: t("statistics.channelOrganic") },
              {
                value: "ai_assistant",
                label: t("statistics.channelAiAssistant"),
              },
            ]}
          />
        </div>
      ) : null}
      {!dates ? null : dateFields.open ? (
        <SeoDateFields model={model} dateFields={dateFields} />
      ) : controls.dates && dateButton ? (
        <SeoDateFilterButton dateFields={dateFields} />
      ) : null}
    </div>
  );
}
