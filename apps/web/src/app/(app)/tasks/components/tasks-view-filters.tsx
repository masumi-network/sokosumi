"use client";

import { TaskStatus } from "@sokosumi/database";
import { Building2, CircleDashed, Sparkles } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
  buildTasksFiltersSearchParams,
  type TasksFilters,
} from "@/app/tasks/utils/tasks-filters";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
import type { CoworkerOption } from "@/lib/types/coworker";

interface TasksViewFiltersProps {
  filters: TasksFilters;
  activeOrganizationId: string | null;
  coworkerOptions: CoworkerOption[];
  labels: {
    title: string;
    searchPlaceholder: string;
    emptyResults: string;
    all: string;
    scopeLabel: string;
    scopeOwned: string;
    scopeWorkspace: string;
    coworkerLabel: string;
    statusLabel: string;
    statusOptions: Record<TaskStatus, string>;
  };
}

export function TasksViewFilters({
  filters,
  activeOrganizationId,
  coworkerOptions,
  labels,
}: TasksViewFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleFilterChange = useCallback(
    (nextFilters: TasksFilters) => {
      const nextSearchParams = buildTasksFiltersSearchParams(
        searchParams,
        nextFilters,
        activeOrganizationId,
      );
      const nextQuery = nextSearchParams.toString();

      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
    },
    [activeOrganizationId, pathname, router, searchParams],
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
            ...filters,
            scope: (scope as TasksFilters["scope"]) ?? "workspace",
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
      id: "coworker",
      label: labels.coworkerLabel,
      icon: Sparkles,
      value: filters.coworkerId,
      allLabel: labels.all,
      onChange: (coworkerId) =>
        handleFilterChange({
          ...filters,
          coworkerId,
        }),
      options: coworkerOptions.map((coworker) => ({
        value: coworker.id,
        label: coworker.name,
        avatarLabel: coworker.name,
        image: coworker.image,
        searchKeywords: [coworker.slug],
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
          ...filters,
          status: (status as TaskStatus | null) ?? null,
        }),
      options: Object.values(TaskStatus).map((status) => ({
        value: status,
        label: labels.statusOptions[status],
      })),
    });

    return nextSections;
  }, [
    activeOrganizationId,
    coworkerOptions,
    filters,
    handleFilterChange,
    labels.all,
    labels.coworkerLabel,
    labels.scopeLabel,
    labels.scopeOwned,
    labels.scopeWorkspace,
    labels.statusLabel,
    labels.statusOptions,
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
