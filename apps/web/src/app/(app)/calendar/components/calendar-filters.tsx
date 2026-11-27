"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import type { CalendarType } from "@/app/calendar/calendar-types";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

export type CalendarFilterSurface = "menu" | "sheet" | null;

interface CalendarFiltersProps {
  available: readonly CalendarType[];
  selected: readonly CalendarType[];
  onChange?: (selected: CalendarType[]) => void;
  showCanceled: boolean;
  onShowCanceledChange: (show: boolean) => void;
  sections: FilterDropdownMenuSection[];
  filtersActive: boolean;
  socialOnly: boolean;
  surface: CalendarFilterSurface;
  setSurface: (surface: CalendarFilterSurface) => void;
}

interface QuickProps {
  available: readonly CalendarType[];
  selected: readonly CalendarType[];
  /** Absent where the features are fixed, as on Social's own page. */
  toggle?: (type: CalendarType, on: boolean) => void;
  showCanceled: boolean;
  /** Only Social posts can be canceled on the Calendar. */
  onShowCanceledChange?: (show: boolean) => void;
}

function ShowSummary({ available, selected }: QuickProps) {
  return (
    <span
      aria-hidden
      className="text-muted-foreground ms-auto text-xs font-normal tabular-nums"
    >
      {selected.length}/{available.length}
    </span>
  );
}

function ShowMenu(props: QuickProps) {
  const t = useTranslations("App.Calendar");
  const { available, selected, toggle, showCanceled, onShowCanceledChange } =
    props;
  return (
    <>
      {toggle ? (
        <>
          <DropdownMenuLabel className="flex items-center">
            {t("show.label")}
            <ShowSummary {...props} />
          </DropdownMenuLabel>
          {available.map((type) => {
            const checked = selected.includes(type);
            return (
              <DropdownMenuCheckboxItem
                key={type}
                checked={checked}
                disabled={checked && selected.length === 1}
                onCheckedChange={(on) => toggle(type, on)}
                // Stay open: a choice of features is made one box at a time.
                onSelect={(event) => event.preventDefault()}
              >
                {t(`show.${type}`)}
              </DropdownMenuCheckboxItem>
            );
          })}
        </>
      ) : null}
      {onShowCanceledChange ? (
        <DropdownMenuCheckboxItem
          checked={showCanceled}
          onCheckedChange={onShowCanceledChange}
          onSelect={(event) => event.preventDefault()}
        >
          {t("show.canceled")}
        </DropdownMenuCheckboxItem>
      ) : null}
    </>
  );
}

function ShowSheet(props: QuickProps) {
  const t = useTranslations("App.Calendar");
  const groupId = useId();
  const { available, selected, toggle, showCanceled, onShowCanceledChange } =
    props;
  return (
    <>
      {toggle ? (
        <section aria-labelledby={groupId}>
          <h3
            id={groupId}
            className="mb-2 flex items-center text-sm font-medium"
          >
            {t("show.label")}
            <ShowSummary {...props} />
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {available.map((type) => {
              const checked = selected.includes(type);
              return (
                <label
                  key={type}
                  className="flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:disabled]:opacity-60"
                >
                  <Checkbox
                    checked={checked}
                    disabled={checked && selected.length === 1}
                    onCheckedChange={(on) => toggle(type, on === true)}
                  />
                  {t(`show.${type}`)}
                </label>
              );
            })}
          </div>
        </section>
      ) : null}
      {onShowCanceledChange ? (
        <label className="mt-2 flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <Checkbox
            checked={showCanceled}
            onCheckedChange={(on) => onShowCanceledChange(on === true)}
          />
          {t("show.canceled")}
        </label>
      ) : null}
    </>
  );
}

/** Which features the Calendar shows, at least one on, and whether canceled posts show. */
export function CalendarFilters({
  available,
  selected,
  onChange,
  showCanceled,
  onShowCanceledChange,
  sections,
  filtersActive,
  socialOnly,
  surface,
  setSurface,
}: CalendarFiltersProps) {
  const t = useTranslations("App.Calendar");
  const tFilters = useTranslations("App.Tasks.Filters");
  const canShowCanceled = selected.includes("social");
  const hasQuick = Boolean(onChange) || canShowCanceled;
  const count =
    sections.filter((section) =>
      section.id === "scope"
        ? section.value === "owned"
        : section.value !== null,
    ).length +
    Number(Boolean(onChange && selected.length < available.length)) +
    Number(canShowCanceled && showCanceled);
  const quick: QuickProps = {
    available,
    selected,
    toggle: onChange
      ? (type, on) => {
          const next = available.filter((other) =>
            other === type ? on : selected.includes(other),
          );
          if (next.length) onChange(next);
        }
      : undefined,
    showCanceled,
    onShowCanceledChange: canShowCanceled ? onShowCanceledChange : undefined,
  };
  return (
    <FilterDropdownMenu
      buttonLabel={hasQuick ? t("showAndFilter") : tFilters("title")}
      emptyResultsLabel={tFilters("emptyResults")}
      searchPlaceholder={tFilters("searchPlaceholder")}
      sections={sections}
      quickFilters={
        hasQuick
          ? { menu: <ShowMenu {...quick} />, sheet: <ShowSheet {...quick} /> }
          : undefined
      }
      activeCount={
        hasQuick && count
          ? { count, label: t("activeFilters", { count }) }
          : undefined
      }
      showActiveIndicator={filtersActive}
      showMobileLabel={hasQuick}
      triggerClassName={
        socialOnly
          ? "min-h-11 min-w-11 sm:min-h-8 sm:min-w-0"
          : hasQuick
            ? // 40px from `sm`, the height of the view switch and
              // "Schedule a task" beside it in the Calendar toolbar.
              "min-h-11 sm:min-h-10"
            : undefined
      }
      dropdownOpen={surface === "menu"}
      onDropdownOpenChange={(open) => setSurface(open ? "menu" : null)}
      sheetOpen={surface === "sheet"}
      onSheetOpenChange={(open) => setSurface(open ? "sheet" : null)}
    />
  );
}
