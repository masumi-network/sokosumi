"use client";

import { Building2, CircleDashed, Sparkles } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
  buildTasksFiltersSearchParams,
  getTasksFiltersFromSearchParams,
  hasActiveTasksFilters,
  type ProjectFilterOption,
  type TasksFilters,
} from "@/app/tasks/utils/tasks-filters";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

interface TasksViewFiltersProps {
  activeOrganizationId: string | null;
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
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
  activeOrganizationId,
  coworkerOptions,
  projectOptions,
  labels,
}: TasksViewFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () =>
      getTasksFiltersFromSearchParams(
        searchParams,
        activeOrganizationId,
        coworkerOptions,
        projectOptions,
      ),
    [activeOrganizationId, coworkerOptions, projectOptions, searchParams],
  );

  const showActiveIndicator = useMemo(
    () => hasActiveTasksFilters(filters, activeOrganizationId),
    [activeOrganizationId, filters],
  );

  const handleFilterChange = useCallback(
    (patch: Partial<TasksFilters>) => {
      const paramsForMerge = new URLSearchParams(
        typeof window !== "undefined"
          ? window.location.search
          : searchParams.toString(),
      );
      const current = getTasksFiltersFromSearchParams(
        paramsForMerge,
        activeOrganizationId,
        coworkerOptions,
        projectOptions,
      );
      const nextFilters: TasksFilters = { ...current, ...patch };
      const nextSearchParams = buildTasksFiltersSearchParams(
        paramsForMerge,
        nextFilters,
        activeOrganizationId,
      );
      const nextQuery = nextSearchParams.toString();

      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
    },
    [
      activeOrganizationId,
      coworkerOptions,
      pathname,
      projectOptions,
      router,
      searchParams,
    ],
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
      value: filters.assigneeSokoBotId ?? filters.assigneeId,
      allLabel: labels.all,
      onChange: (selectedId) => {
        const selected = coworkerOptions.find(
          (option) => option.id === selectedId,
        );
        if (selected?.kind === "orchestrator") {
          handleFilterChange({
            assigneeId: null,
            assigneeSokoBotId: selectedId,
          });
          return;
        }
        handleFilterChange({
          assigneeId: selectedId,
          assigneeSokoBotId: null,
        });
      },
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
      showActiveIndicator={showActiveIndicator}
    />
  );
}
