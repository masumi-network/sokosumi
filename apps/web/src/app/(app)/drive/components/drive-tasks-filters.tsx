"use client";

import {
  getCoworkers,
  getProjectsById,
  getTasksById,
} from "@sokosumi/core-client";
import { Bot, FolderKanban, ListCheck } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
import { useSession } from "@/lib/auth/auth.client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import { fetchDriveTasksPage } from "@/lib/utils/drive-tasks-list.client";
import {
  useScopedInfiniteQuery,
  useScopedQuery,
} from "@/queries/scoped-queries";

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
    retryLoadMore?: string;
  };
  hideMobileTrigger?: boolean;
  sheetOpen?: boolean;
  onSheetOpenChange?: (open: boolean) => void;
}

function resolveNextCursor(
  cursor: string | null,
  previousCursor?: string,
): string | null {
  if (!cursor) {
    return null;
  }
  if (previousCursor && cursor === previousCursor) {
    return null;
  }
  return cursor;
}

function mapDriveTasksToProjectOptions(
  items: Awaited<ReturnType<typeof fetchDriveTasksPage>>["items"],
  noProjectLabel: string,
): DriveTasksProjectFilterOption[] {
  return items.flatMap((item) => {
    if (item.type === "project") {
      return [{ id: item.id, name: item.name }];
    }
    if (item.type === "no-project") {
      return [{ id: item.id, name: noProjectLabel }];
    }
    return [];
  });
}

function mapDriveTasksToTaskOptions(
  items: Awaited<ReturnType<typeof fetchDriveTasksPage>>["items"],
): DriveTasksTaskFilterOption[] {
  return items.flatMap((item) =>
    item.type === "task" ? [{ id: item.id, name: item.name }] : [],
  );
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
  labels,
  hideMobileTrigger = false,
  sheetOpen,
  onSheetOpenChange,
}: DriveTasksFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const viewerId = session?.user?.id ?? null;
  const store = driveStoreForActiveWorkspace(activeOrganizationId);
  const canLoadStore = !(store.scope === "org" && !activeOrganizationId);
  const workspaceScope = [activeOrganizationId, viewerId] as const;
  const tasksStoreScope = [
    store.scope,
    store.scope === "org" ? activeOrganizationId : null,
    viewerId,
  ] as const;

  const coworkersQuery = useScopedQuery({
    scope: workspaceScope,
    queryKey: ["drive", "tasks-filters", "coworkers"],
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const response = await getCoworkers({
        client: getBrowserCoreClient(),
        query: { scope: "available", capability: ["tasks"] },
        signal,
      });
      if (response.error || !response.data) {
        throw response.error ?? new Error("Failed to load coworkers");
      }
      return response.data.data ?? [];
    },
  });

  const projectsQuery = useScopedInfiniteQuery({
    scope: tasksStoreScope,
    queryKey: ["drive", "tasks-filters", "projects", assigneeId],
    enabled: canLoadStore,
    initialPageParam: undefined as string | undefined,
    staleTime: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchDriveTasksPage({
        scope: store.scope,
        ...(store.scope === "org" && activeOrganizationId
          ? { organizationId: activeOrganizationId }
          : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        signal,
      }),
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      resolveNextCursor(lastPage.nextCursor, lastPageParam) ?? undefined,
  });

  const coworkers = coworkersQuery.isError ? [] : (coworkersQuery.data ?? []);
  const projects = useMemo(
    () =>
      (projectsQuery.data?.pages ?? []).flatMap((page) =>
        mapDriveTasksToProjectOptions(page.items, labels.noProjectLabel),
      ),
    [projectsQuery.data?.pages, labels.noProjectLabel],
  );
  const projectsNextCursor = projectsQuery.hasNextPage
    ? (projectsQuery.data?.pages.at(-1)?.nextCursor ?? null)
    : null;
  const projectsLoadingMore = projectsQuery.isFetchingNextPage;
  const projectsLoadMoreFailed = projectsQuery.isFetchNextPageError;

  const needsSelectedProjectFetch =
    Boolean(projectId) &&
    projectId !== "null" &&
    !projects.some((project) => project.id === projectId);

  const selectedProjectQuery = useScopedQuery({
    scope: workspaceScope,
    queryKey: ["drive", "project-name", projectId],
    enabled: needsSelectedProjectFetch,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      if (!projectId) return null;
      const response = await getProjectsById({
        client: getBrowserCoreClient(),
        path: { id: projectId },
        signal,
        throwOnError: true,
      });
      return response.data?.data?.name ?? null;
    },
  });

  const selectedProjectName =
    projectId === "null"
      ? labels.noProjectLabel
      : needsSelectedProjectFetch
        ? (selectedProjectQuery.data ?? null)
        : null;

  const tasksQuery = useScopedInfiniteQuery({
    scope: tasksStoreScope,
    queryKey: ["drive", "tasks-filters", "tasks", projectId, assigneeId],
    enabled: Boolean(projectId) && canLoadStore,
    initialPageParam: undefined as string | undefined,
    staleTime: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchDriveTasksPage({
        scope: store.scope,
        ...(store.scope === "org" && activeOrganizationId
          ? { organizationId: activeOrganizationId }
          : {}),
        projectId: projectId ?? undefined,
        ...(assigneeId ? { assigneeId } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        signal,
      }),
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      resolveNextCursor(lastPage.nextCursor, lastPageParam) ?? undefined,
  });

  const tasks = useMemo(
    () =>
      !projectId
        ? []
        : (tasksQuery.data?.pages ?? []).flatMap((page) =>
            mapDriveTasksToTaskOptions(page.items),
          ),
    [projectId, tasksQuery.data?.pages],
  );
  const tasksNextCursor =
    projectId && tasksQuery.hasNextPage
      ? (tasksQuery.data?.pages.at(-1)?.nextCursor ?? null)
      : null;
  const tasksLoadingMore = tasksQuery.isFetchingNextPage;
  const tasksLoadMoreFailed = tasksQuery.isFetchNextPageError;

  const needsSelectedTaskFetch =
    Boolean(taskId) &&
    Boolean(projectId) &&
    !tasks.some((task) => task.id === taskId);

  const selectedTaskQuery = useScopedQuery({
    scope: workspaceScope,
    queryKey: ["drive", "task-name", taskId],
    enabled: needsSelectedTaskFetch,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      if (!taskId) return null;
      const response = await getTasksById({
        client: getBrowserCoreClient(),
        path: { id: taskId },
        signal,
        throwOnError: true,
      });
      return response.data?.data?.name ?? null;
    },
  });

  const selectedTaskName = needsSelectedTaskFetch
    ? (selectedTaskQuery.data ?? null)
    : null;

  const { fetchNextPage: fetchNextProjectsPage } = projectsQuery;
  const loadMoreProjects = useCallback(async () => {
    if (!projectsNextCursor || projectsLoadingMore) {
      return;
    }
    await fetchNextProjectsPage();
  }, [fetchNextProjectsPage, projectsLoadingMore, projectsNextCursor]);

  const { fetchNextPage: fetchNextTasksPage } = tasksQuery;
  const loadMoreTasks = useCallback(async () => {
    if (!projectId || !tasksNextCursor || tasksLoadingMore) {
      return;
    }
    await fetchNextTasksPage();
  }, [fetchNextTasksPage, projectId, tasksLoadingMore, tasksNextCursor]);

  const handleFilterChange = useCallback(
    (param: "assigneeId" | "projectId" | "taskId", value: string | null) => {
      const params = buildDriveTasksFilterParams(searchParams, param, value);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const showActiveIndicator =
    assigneeId !== null || projectId !== null || taskId !== null;

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
        ...(projectId &&
        selectedProjectName &&
        !projects.some((project) => project.id === projectId)
          ? [{ value: projectId, label: selectedProjectName }]
          : []),
        ...projects.map((project) => ({
          value: project.id,
          label: project.name,
        })),
      ],
      pagination: projectsNextCursor
        ? {
            nextCursor: projectsNextCursor,
            onLoadMore: () => {
              void loadMoreProjects();
            },
            isLoadingMore: projectsLoadingMore,
            loadMoreLabel: projectsLoadMoreFailed
              ? (labels.retryLoadMore ?? labels.loadMore)
              : labels.loadMore,
          }
        : undefined,
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
          ...(taskId &&
          selectedTaskName &&
          !tasks.some((task) => task.id === taskId)
            ? [{ value: taskId, label: selectedTaskName }]
            : []),
          ...tasks.map((task) => ({
            value: task.id,
            label: task.name,
          })),
        ],
        pagination: tasksNextCursor
          ? {
              nextCursor: tasksNextCursor,
              onLoadMore: () => {
                void loadMoreTasks();
              },
              isLoadingMore: tasksLoadingMore,
              loadMoreLabel: tasksLoadMoreFailed
                ? (labels.retryLoadMore ?? labels.loadMore)
                : labels.loadMore,
            }
          : undefined,
      });
    }

    return nextSections;
  }, [
    assigneeId,
    projectId,
    taskId,
    coworkers,
    projects,
    projectsNextCursor,
    projectsLoadingMore,
    projectsLoadMoreFailed,
    selectedProjectName,
    tasks,
    tasksNextCursor,
    tasksLoadingMore,
    tasksLoadMoreFailed,
    selectedTaskName,
    handleFilterChange,
    loadMoreProjects,
    loadMoreTasks,
    labels.all,
    labels.coworkerLabel,
    labels.loadMore,
    labels.retryLoadMore,
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
