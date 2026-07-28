"use client";

import { Building2, CircleDashed, FolderKanban, ListTodo } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import {
  buildHistoryFiltersSearchParams,
  getHistoryFiltersFromSearchParams,
  getHistoryStatusOptionsForType,
  type HistoryFilters,
  type HistoryStatus,
  type HistoryType,
  isHistoryStatusAllowedForType,
  type ProjectFilterOption,
} from "@/app/history/utils/history-filters";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";

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
    statusLabel: string;
    projectLabel: string;
    typeOptions: Record<HistoryType, string>;
    statusOptions: Record<HistoryStatus, string>;
  };
}

const HISTORY_TYPE_OPTIONS: HistoryType[] = ["task", "job"];

export function HistoryViewFilters({
  activeOrganizationId,
  projectOptions,
  labels,
}: HistoryViewFiltersProps) {
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
      icon: ListTodo,
      value: filters.type,
      allLabel: labels.all,
      onChange: (type) => {
        const nextType = (type as HistoryType | null) ?? null;
        handleFilterChange({
          type: nextType,
          status:
            filters.status &&
            !isHistoryStatusAllowedForType(filters.status, nextType)
              ? null
              : filters.status,
        });
      },
      options: HISTORY_TYPE_OPTIONS.map((type) => ({
        value: type,
        label: labels.typeOptions[type],
      })),
    });

    nextSections.push({
      id: "status",
      label: labels.statusLabel,
      icon: CircleDashed,
      value: filters.status,
      allLabel: labels.all,
      onChange: (status) =>
        handleFilterChange({
          status: (status as HistoryStatus | null) ?? null,
        }),
      options: getHistoryStatusOptionsForType(filters.type).map((status) => ({
        value: status,
        label: labels.statusOptions[status],
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
    labels.statusLabel,
    labels.statusOptions,
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
    />
  );
}
