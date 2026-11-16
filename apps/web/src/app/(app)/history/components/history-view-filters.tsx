"use client";

import { Building2, FolderKanban, Receipt } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";

import {
  buildHistoryFiltersSearchParams,
  getHistoryFiltersFromSearchParams,
  HISTORY_TYPE_VALUES,
  type HistoryFilters,
  type HistoryType,
  type ProjectFilterOption,
} from "@/app/history/utils/history-filters";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChipRemoveButton } from "@/components/ui/chip-remove-button";

interface HistoryViewFiltersProps {
  activeOrganizationId: string | null;
  projectOptions: ProjectFilterOption[];
  labels: {
    title: string;
    searchPlaceholder: string;
    emptyResults: string;
    all: string;
    scopeLabel: string;
    scopeOwned: string;
    scopeWorkspace: string;
    typeLabel: string;
    projectLabel: string;
    typeOptions: Record<HistoryType, string>;
  };
}

/** Filters from the URL, and a setter that merges a patch into the live URL. */
function useHistoryFilters(
  activeOrganizationId: string | null,
  projectOptions: ProjectFilterOption[],
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () =>
      getHistoryFiltersFromSearchParams(
        searchParams,
        activeOrganizationId,
        projectOptions,
      ),
    [activeOrganizationId, projectOptions, searchParams],
  );

  const handleFilterChange = useCallback(
    (patch: Partial<HistoryFilters>) => {
      const paramsForMerge = new URLSearchParams(
        typeof window !== "undefined"
          ? window.location.search
          : searchParams.toString(),
      );
      const current = getHistoryFiltersFromSearchParams(
        paramsForMerge,
        activeOrganizationId,
        projectOptions,
      );
      const nextSearchParams = buildHistoryFiltersSearchParams(
        paramsForMerge,
        { ...current, ...patch },
        activeOrganizationId,
      );
      const nextQuery = nextSearchParams.toString();

      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
    },
    [activeOrganizationId, pathname, projectOptions, router, searchParams],
  );

  return { filters, handleFilterChange };
}

export function HistoryViewFilters({
  activeOrganizationId,
  projectOptions,
  labels,
}: HistoryViewFiltersProps) {
  const t = useTranslations("App.TransactionHistory.Filters");
  const { filters, handleFilterChange } = useHistoryFilters(
    activeOrganizationId,
    projectOptions,
  );
  // Matches the Source and Project chips; scope is a view, not a narrowing filter.
  const activeCount = [filters.type, filters.projectId].filter(Boolean).length;

  const sections = useMemo<FilterDropdownMenuSection[]>(() => {
    const nextSections: FilterDropdownMenuSection[] = [];

    if (activeOrganizationId !== null) {
      nextSections.push({
        id: "scope",
        label: labels.scopeLabel,
        icon: Building2,
        value: filters.scope,
        onChange: (scope) =>
          handleFilterChange({
            scope: (scope as HistoryFilters["scope"]) ?? "workspace",
          }),
        options: [
          {
            value: "workspace",
            label: labels.scopeWorkspace,
          },
          {
            value: "owned",
            label: labels.scopeOwned,
          },
        ],
      });
    }

    nextSections.push({
      id: "type",
      label: labels.typeLabel,
      icon: Receipt,
      value: filters.type,
      allLabel: labels.all,
      onChange: (type) =>
        handleFilterChange({ type: (type as HistoryType | null) ?? null }),
      options: HISTORY_TYPE_VALUES.map((type) => ({
        value: type,
        label: labels.typeOptions[type],
      })),
    });

    nextSections.push({
      id: "project",
      label: labels.projectLabel,
      icon: FolderKanban,
      value: filters.projectId,
      allLabel: labels.all,
      onChange: (projectId) =>
        handleFilterChange({
          projectId,
        }),
      options: projectOptions.map((project) => ({
        value: project.id,
        label: project.name,
        searchKeywords: [project.name],
      })),
    });

    return nextSections;
  }, [
    activeOrganizationId,
    filters,
    handleFilterChange,
    labels.all,
    labels.projectLabel,
    labels.scopeLabel,
    labels.scopeOwned,
    labels.scopeWorkspace,
    labels.typeLabel,
    labels.typeOptions,
    projectOptions,
  ]);

  return (
    <FilterDropdownMenu
      buttonLabel={labels.title}
      searchPlaceholder={labels.searchPlaceholder}
      emptyResultsLabel={labels.emptyResults}
      sections={sections}
      activeCount={
        activeCount
          ? {
              count: activeCount,
              label: t("activeCount", { count: activeCount }),
            }
          : undefined
      }
    />
  );
}

/**
 * The search, Source and Project the list is narrowed by, as removable chips.
 * On phones the search box is collapsed, so this is where an active search
 * stays visible. Scope and a Task filter are left alone: removing a chip or
 * Clear all changes only search, Source and Project.
 */
export function HistoryActiveFilters({
  activeOrganizationId,
  projectOptions,
  labels,
  onSearchReset,
}: HistoryViewFiltersProps & {
  /** Called before a removal that clears the search, so the box drops pending typing. */
  onSearchReset?: () => void;
}) {
  const t = useTranslations("App.TransactionHistory.Filters");
  const { filters, handleFilterChange } = useHistoryFilters(
    activeOrganizationId,
    projectOptions,
  );

  const chips = [
    filters.q && {
      id: "q",
      label: t("searchLabel"),
      value: filters.q,
      clear: { q: null },
    },
    filters.type && {
      id: "type",
      label: labels.typeLabel,
      value: labels.typeOptions[filters.type],
      clear: { type: null },
    },
    filters.projectId && {
      id: "project",
      label: labels.projectLabel,
      value:
        projectOptions.find((project) => project.id === filters.projectId)
          ?.name ?? filters.projectId,
      clear: { projectId: null },
    },
  ].filter((chip) => !!chip);

  if (chips.length === 0) {
    return null;
  }

  // A removed chip unmounts its focused button; hand focus to the Filters
  // trigger, the last visible button in the toolbar's control group.
  function clearAndRefocus(patch: Partial<HistoryFilters>, from: HTMLElement) {
    const controls = from
      .closest("[data-history-toolbar]")
      ?.querySelector("[data-history-filters]");
    if ("q" in patch) onSearchReset?.();
    handleFilterChange(patch);
    Array.from(controls?.querySelectorAll<HTMLElement>("button") ?? [])
      .findLast((button) => button.offsetParent !== null)
      ?.focus();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ul
        aria-label={t("activeFilters")}
        className="flex min-w-0 flex-wrap gap-2"
      >
        {chips.map((chip) => {
          const name = t("chip", { label: chip.label, value: chip.value });
          return (
            <li
              key={chip.id}
              className="bg-muted text-foreground inline-flex min-w-0 max-w-full items-center rounded-full ps-3 text-sm"
            >
              <span className="min-w-0 wrap-anywhere py-1">{name}</span>
              <ChipRemoveButton
                aria-label={t("removeFilter", { filter: name })}
                onClick={(event) =>
                  clearAndRefocus(chip.clear, event.currentTarget)
                }
              />
            </li>
          );
        })}
      </ul>
      {chips.length > 1 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={(event) =>
            clearAndRefocus(
              { q: null, type: null, projectId: null },
              event.currentTarget,
            )
          }
        >
          {t("clearAll")}
        </Button>
      ) : null}
    </div>
  );
}
