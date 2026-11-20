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
  sections: FilterDropdownMenuSection[];
  filtersActive: boolean;
  socialOnly: boolean;
  surface: CalendarFilterSurface;
  setSurface: (surface: CalendarFilterSurface) => void;
}

/** Which features the Calendar shows; at least one stays on. */
export function CalendarFilters({
  available,
  selected,
  onChange,
  sections,
  filtersActive,
  socialOnly,
  surface,
  setSurface,
}: CalendarFiltersProps) {
  const t = useTranslations("App.Calendar");
  const tFilters = useTranslations("App.Tasks.Filters");
  const groupId = useId();
  const hidden = selected.length < available.length;
  const count =
    sections.filter((section) =>
      section.id === "scope"
        ? section.value === "owned"
        : section.value !== null,
    ).length + Number(Boolean(onChange && hidden));
  function toggle(type: CalendarType, on: boolean) {
    const next = available.filter((other) =>
      other === type ? on : selected.includes(other),
    );
    if (next.length) onChange?.(next);
  }
  const summary = (
    <span
      aria-hidden
      className="text-muted-foreground ms-auto text-xs font-normal tabular-nums"
    >
      {selected.length}/{available.length}
    </span>
  );
  return (
    <FilterDropdownMenu
      buttonLabel={onChange ? t("showAndFilter") : tFilters("title")}
      emptyResultsLabel={tFilters("emptyResults")}
      searchPlaceholder={tFilters("searchPlaceholder")}
      sections={sections}
      quickFilters={
        onChange
          ? {
              menu: (
                <>
                  <DropdownMenuLabel className="flex items-center">
                    {t("show.label")}
                    {summary}
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
              ),
              sheet: (
                <section aria-labelledby={groupId}>
                  <h3
                    id={groupId}
                    className="mb-2 flex items-center text-sm font-medium"
                  >
                    {t("show.label")}
                    {summary}
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
              ),
            }
          : undefined
      }
      activeCount={
        onChange && count
          ? { count, label: t("activeFilters", { count }) }
          : undefined
      }
      showActiveIndicator={filtersActive}
      showMobileLabel={Boolean(onChange)}
      triggerClassName={
        socialOnly
          ? "min-h-11 min-w-11 sm:min-h-8 sm:min-w-0"
          : onChange
            ? "min-h-11 sm:min-h-8"
            : undefined
      }
      dropdownOpen={surface === "menu"}
      onDropdownOpenChange={(open) => setSurface(open ? "menu" : null)}
      sheetOpen={surface === "sheet"}
      onSheetOpenChange={(open) => setSurface(open ? "sheet" : null)}
    />
  );
}
