"use client";

import type { DriveTasksListItem } from "@sokosumi/core-client";
import { Bot, FolderKanban, ListCheck } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
  type FilterDropdownMenuSectionPagination,
} from "@/components/common/filter-dropdown-menu";
import { useDriveTasksFilterCoworkers } from "@/hooks/effects/use-drive-tasks-filter-coworkers";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import {
  type DriveTasksSelectedEntity,
  fetchDriveTasksPage,
} from "@/lib/utils/drive-tasks-list.client";
import { driveQueryKeys, splitDriveQueryKey } from "@/queries/drive";
import { useScopedInfiniteQuery } from "@/queries/scoped-queries";

interface DriveTasksProjectFilterOption {
  id: string;
  name: string;
}

interface DriveTasksTaskFilterOption {
  id: string;
  name: string;
}

interface DriveTasksFiltersProps {
  activeOrganizationId: string | null;
  assigneeId: string | null;
  projectId: string | null;
  taskId: string | null;
  selectedProject?: DriveTasksSelectedEntity | null;
  selectedTask?: DriveTasksSelectedEntity | null;
  labels: {
    title: string;
    searchPlaceholder: string;
    emptyResults: string;
    all: string;
    coworkerLabel: string;
    projectLabel: string;
    taskLabel: string;
    noProjectLabel: string;
    loadMore: string;
    retry?: string;
  };
  hideMobileTrigger?: boolean;
  sheetOpen?: boolean;
  onSheetOpenChange?: (open: boolean) => void;
}

function mapDriveTasksToProjectOptions(
  pages: readonly { items: readonly DriveTasksListItem[] }[],
  noProjectLabel: string,
): DriveTasksProjectFilterOption[] {
  const seen = new Set<string>();
  const options: DriveTasksProjectFilterOption[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type === "project") {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        options.push({ id: item.id, name: item.name });
      } else if (item.type === "no-project") {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        options.push({ id: item.id, name: noProjectLabel });
      }
    }
  }
  return options;
}

function mapDriveTasksToTaskOptions(
  pages: readonly { items: readonly DriveTasksListItem[] }[],
): DriveTasksTaskFilterOption[] {
  const seen = new Set<string>();
  const options: DriveTasksTaskFilterOption[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type !== "task" || seen.has(item.id)) continue;
      seen.add(item.id);
      options.push({ id: item.id, name: item.name });
    }
  }
  return options;
}

function buildSectionPagination(
  query: {
    hasNextPage: boolean;
    isError: boolean;
    isFetchNextPageError: boolean;
    isFetching: boolean;
    isFetchingNextPage: boolean;
    data?: { pages: readonly { nextCursor: string | null }[] };
    fetchNextPage: (options?: { cancelRefetch?: boolean }) => Promise<unknown>;
    refetch: () => Promise<unknown>;
  },
  labels: { loadMore: string; retry: string },
): FilterDropdownMenuSectionPagination | undefined {
  const isRefreshingPageOne = query.isFetching && !query.isFetchingNextPage;

  if (query.isError) {
    return {
      nextCursor: "retry",
      onLoadMore: () => {
        if (query.isFetchNextPageError) {
          if (isRefreshingPageOne || query.isFetchingNextPage) return;
          void query.fetchNextPage({ cancelRefetch: false });
          return;
        }
        if (isRefreshingPageOne) return;
        void query.refetch();
      },
      isLoadingMore: query.isFetchNextPageError
        ? query.isFetchingNextPage || isRefreshingPageOne
        : isRefreshingPageOne,
      loadMoreLabel: labels.retry,
    };
  }

  const nextCursor = query.data?.pages.at(-1)?.nextCursor ?? null;
  if (!query.hasNextPage || !nextCursor) {
    return undefined;
  }

  return {
    nextCursor,
    onLoadMore: () => {
      if (query.isFetching) return;
      void query.fetchNextPage({ cancelRefetch: false });
    },
    isLoadingMore: query.isFetching,
    loadMoreLabel: labels.loadMore,
  };
}

export function buildDriveTasksFilterParams(
  searchParams: URLSearchParams,
  param: "assigneeId" | "projectId" | "taskId",
  value: string | null,
): URLSearchParams {
  const params = new URLSearchParams(searchParams.toString());
  if (value) {
    params.set(param, value);
  } else {
    params.delete(param);
  }

  if (param === "assigneeId") {
    params.delete("projectId");
    params.delete("taskId");
  } else if (param === "projectId") {
    params.delete("taskId");
  }

  return params;
}

export function DriveTasksFilters({
  activeOrganizationId,
  assigneeId,
  projectId,
  taskId,
  selectedProject,
  selectedTask,
  labels,
  hideMobileTrigger = false,
  sheetOpen,
  onSheetOpenChange,
}: DriveTasksFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const driveStore = driveStoreForActiveWorkspace(activeOrganizationId);
  const isStoreEnabled =
    driveStore.scope !== "org" || Boolean(driveStore.organizationId);

  const coworkers = useDriveTasksFilterCoworkers(activeOrganizationId);

  const projectsQuery = useScopedInfiniteQuery({
    ...splitDriveQueryKey(driveQueryKeys.tasks(driveStore, { assigneeId })),
    queryFn: ({ pageParam, signal }) =>
      fetchDriveTasksPage({
        scope: driveStore.scope,
        ...(driveStore.scope === "org"
          ? { organizationId: driveStore.organizationId }
          : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: isStoreEnabled,
    staleTime: 0,
  });

  const tasksQuery = useScopedInfiniteQuery({
    ...splitDriveQueryKey(
      driveQueryKeys.tasks(driveStore, { projectId, assigneeId }),
    ),
    queryFn: ({ pageParam, signal }) =>
      fetchDriveTasksPage({
        scope: driveStore.scope,
        ...(driveStore.scope === "org"
          ? { organizationId: driveStore.organizationId }
          : {}),
        ...(projectId ? { projectId } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: isStoreEnabled && Boolean(projectId),
    staleTime: 0,
  });

  const projects = useMemo(
    () =>
      mapDriveTasksToProjectOptions(
        projectsQuery.data?.pages ?? [],
        labels.noProjectLabel,
      ),
    [projectsQuery.data?.pages, labels.noProjectLabel],
  );

  const tasks = useMemo(
    () => mapDriveTasksToTaskOptions(tasksQuery.data?.pages ?? []),
    [tasksQuery.data?.pages],
  );

  const handleFilterChange = useCallback(
    (param: "assigneeId" | "projectId" | "taskId", value: string | null) => {
      const params = buildDriveTasksFilterParams(searchParams, param, value);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const resolvedSelectedProject =
    projectId && selectedProject?.id === projectId
      ? selectedProject
      : projectId &&
          tasksQuery.data?.pages[0]?.selectedProject?.id === projectId
        ? tasksQuery.data.pages[0].selectedProject
        : null;
  const resolvedSelectedTask =
    taskId && selectedTask?.id === taskId ? selectedTask : null;

  const showActiveIndicator =
    assigneeId !== null || projectId !== null || taskId !== null;
  const retryLabel = labels.retry ?? labels.loadMore;

  const projectsPagination = buildSectionPagination(projectsQuery, {
    loadMore: labels.loadMore,
    retry: retryLabel,
  });
  const tasksPagination = buildSectionPagination(tasksQuery, {
    loadMore: labels.loadMore,
    retry: retryLabel,
  });

  const sections = useMemo<FilterDropdownMenuSection[]>(() => {
    const nextSections: FilterDropdownMenuSection[] = [];

    nextSections.push({
      id: "coworker",
      label: labels.coworkerLabel,
      icon: Bot,
      value: assigneeId,
      allLabel: labels.all,
      onChange: (value) => handleFilterChange("assigneeId", value),
      options: coworkers.map((coworker) => ({
        value: coworker.id,
        label: coworker.name,
        avatarLabel: coworker.name,
        image: coworker.image,
        searchKeywords: [coworker.slug],
      })),
    });

    nextSections.push({
      id: "project",
      label: labels.projectLabel,
      icon: FolderKanban,
      value: projectId,
      allLabel: labels.all,
      onChange: (value) => handleFilterChange("projectId", value),
      options: [
        ...(projectId === "null" &&
        !projects.some((project) => project.id === "null")
          ? [{ value: "null", label: labels.noProjectLabel }]
          : resolvedSelectedProject &&
              !projects.some(
                (project) => project.id === resolvedSelectedProject.id,
              )
            ? [
                {
                  value: resolvedSelectedProject.id,
                  label: resolvedSelectedProject.name,
                },
              ]
            : []),
        ...projects.map((project) => ({
          value: project.id,
          label: project.name,
        })),
      ],
      pagination: projectsPagination,
    });

    if (projectId) {
      nextSections.push({
        id: "task",
        label: labels.taskLabel,
        icon: ListCheck,
        value: taskId,
        allLabel: labels.all,
        onChange: (value) => handleFilterChange("taskId", value),
        options: [
          ...(resolvedSelectedTask &&
          !tasks.some((task) => task.id === resolvedSelectedTask.id)
            ? [
                {
                  value: resolvedSelectedTask.id,
                  label: resolvedSelectedTask.name,
                },
              ]
            : []),
          ...tasks.map((task) => ({
            value: task.id,
            label: task.name,
          })),
        ],
        pagination: tasksPagination,
      });
    }

    return nextSections;
  }, [
    assigneeId,
    projectId,
    taskId,
    coworkers,
    projects,
    projectsPagination,
    resolvedSelectedProject,
    tasks,
    tasksPagination,
    resolvedSelectedTask,
    handleFilterChange,
    labels.all,
    labels.coworkerLabel,
    labels.projectLabel,
    labels.taskLabel,
    labels.noProjectLabel,
  ]);

  return (
    <FilterDropdownMenu
      buttonLabel={labels.title}
      searchPlaceholder={labels.searchPlaceholder}
      emptyResultsLabel={labels.emptyResults}
      sections={sections}
      showActiveIndicator={showActiveIndicator}
      hideMobileTrigger={hideMobileTrigger}
      sheetOpen={sheetOpen}
      onSheetOpenChange={onSheetOpenChange}
    />
  );
}
