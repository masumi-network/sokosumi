"use client";

import { Building2, CircleDashed, FolderKanban, Sparkles } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
  buildJobsListFiltersSearchParams,
  getJobsListFiltersFromSearchParams,
  type JobsListFilters,
} from "@/app/tasks/utils/jobs-filters";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
import { AgentJobStatus } from "@/lib/clients/generated/core";

interface JobsViewFiltersProps {
  activeOrganizationId: string | null;
  agentOptions: Array<{ id: string; name: string; image: string | null }>;
  projectOptions: ProjectFilterOption[];
  filtersLabels: {
    title: string;
    searchPlaceholder: string;
    emptyResults: string;
    all: string;
    scopeLabel: string;
    scopeOwned: string;
    scopeWorkspace: string;
    projectLabel: string;
  };
  labels: {
    filterButton: string;
    agentLabel: string;
    jobStatusLabel: string;
    jobStatusOptions: Record<AgentJobStatus, string>;
  };
}

export function JobsViewFilters({
  activeOrganizationId,
  agentOptions,
  projectOptions,
  filtersLabels,
  labels,
}: JobsViewFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () =>
      getJobsListFiltersFromSearchParams(
        searchParams,
        activeOrganizationId,
        agentOptions,
        projectOptions,
      ),
    [activeOrganizationId, agentOptions, projectOptions, searchParams],
  );

  const handleFilterChange = useCallback(
    (patch: Partial<JobsListFilters>) => {
      const paramsForMerge = new URLSearchParams(
        typeof window !== "undefined"
          ? window.location.search
          : searchParams.toString(),
      );
      const current = getJobsListFiltersFromSearchParams(
        paramsForMerge,
        activeOrganizationId,
        agentOptions,
        projectOptions,
      );
      const nextFilters: JobsListFilters = { ...current, ...patch };
      const nextSearchParams = buildJobsListFiltersSearchParams(
        paramsForMerge,
        nextFilters,
        activeOrganizationId,
      );
      const nextQuery = nextSearchParams.toString();

      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
    },
    [
      activeOrganizationId,
      agentOptions,
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
        label: filtersLabels.scopeLabel,
        icon: Building2,
        value: filters.scope,
        onChange: (scope) =>
          handleFilterChange({
            scope: (scope as JobsListFilters["scope"]) ?? "workspace",
          }),
        options: [
          {
            value: "workspace",
            label: filtersLabels.scopeWorkspace,
          },
          {
            value: "owned",
            label: filtersLabels.scopeOwned,
          },
        ],
      });
    }

    nextSections.push({
      id: "agent",
      label: labels.agentLabel,
      icon: Sparkles,
      value: filters.agentId,
      allLabel: filtersLabels.all,
      onChange: (agentId) =>
        handleFilterChange({
          agentId,
        }),
      options: agentOptions.map((agent) => ({
        value: agent.id,
        label: agent.name,
        avatarLabel: agent.name,
        image: agent.image,
        useAgentIcon: true,
      })),
    });

    nextSections.push({
      id: "jobStatus",
      label: labels.jobStatusLabel,
      icon: CircleDashed,
      value: filters.jobStatus,
      allLabel: filtersLabels.all,
      onChange: (jobStatus) =>
        handleFilterChange({
          jobStatus: (jobStatus as AgentJobStatus | null) ?? null,
        }),
      options: Object.values(AgentJobStatus).map((jobStatus) => ({
        value: jobStatus,
        label: labels.jobStatusOptions[jobStatus],
      })),
    });

    nextSections.push({
      id: "project",
      label: filtersLabels.projectLabel,
      icon: FolderKanban,
      value: filters.projectId,
      allLabel: filtersLabels.all,
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
    agentOptions,
    filters.scope,
    filters.agentId,
    filters.jobStatus,
    filters.projectId,
    filtersLabels.all,
    filtersLabels.projectLabel,
    filtersLabels.scopeLabel,
    filtersLabels.scopeOwned,
    filtersLabels.scopeWorkspace,
    handleFilterChange,
    labels.agentLabel,
    labels.jobStatusLabel,
    labels.jobStatusOptions,
    projectOptions,
  ]);

  return (
    <FilterDropdownMenu
      buttonLabel={labels.filterButton}
      searchPlaceholder={filtersLabels.searchPlaceholder}
      emptyResultsLabel={filtersLabels.emptyResults}
      sections={sections}
    />
  );
}
