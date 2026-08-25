"use client";

import { Folder, ListCheck, Sparkles } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import {
  type Coworker,
  getCoworkers,
  getProjectsById,
  getTasksById,
} from "@/lib/clients/generated/core";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import { fetchDriveTasksPage } from "@/lib/utils/drive-tasks-list.client";

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
  };
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
}: DriveTasksFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [coworkers, setCoworkers] = useState<Coworker[]>([]);
  const [projects, setProjects] = useState<DriveTasksProjectFilterOption[]>([]);
  const [projectsNextCursor, setProjectsNextCursor] = useState<string | null>(
    null,
  );
  const [projectsLoadingMore, setProjectsLoadingMore] = useState(false);
  const [tasks, setTasks] = useState<DriveTasksTaskFilterOption[]>([]);
  const [tasksNextCursor, setTasksNextCursor] = useState<string | null>(null);
  const [tasksLoadingMore, setTasksLoadingMore] = useState(false);
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(
    null,
  );
  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);
  const loadMoreProjectsAbortRef = useRef<AbortController | null>(null);
  const loadMoreTasksAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    async function loadCoworkers() {
      try {
        const response = await getCoworkers({
          client: getBrowserCoreClient(),
          query: { scope: "available", capability: ["tasks"] },
        });
        setCoworkers(response.data?.data ?? []);
      } catch {
        setCoworkers([]);
      }
    }
    void loadCoworkers();
  }, []);

  useEffect(() => {
    const store = driveStoreForActiveWorkspace(activeOrganizationId);
    if (store.scope === "org" && !activeOrganizationId) {
      setProjects([]);
      setProjectsNextCursor(null);
      return;
    }

    const controller = new AbortController();

    async function loadProjects() {
      try {
        const page = await fetchDriveTasksPage({
          scope: store.scope,
          ...(store.scope === "org" && activeOrganizationId
            ? { organizationId: activeOrganizationId }
            : {}),
          ...(assigneeId ? { assigneeId } : {}),
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setProjects(
            mapDriveTasksToProjectOptions(page.items, labels.noProjectLabel),
          );
          setProjectsNextCursor(page.nextCursor);
        }
      } catch {
        if (!controller.signal.aborted) {
          setProjects([]);
          setProjectsNextCursor(null);
        }
      }
    }
    void loadProjects();
    return () => {
      controller.abort();
      loadMoreProjectsAbortRef.current?.abort();
      loadMoreProjectsAbortRef.current = null;
    };
  }, [activeOrganizationId, assigneeId, labels.noProjectLabel]);

  useEffect(() => {
    if (!projectId || projectId === "null") {
      setSelectedProjectName(
        projectId === "null" ? labels.noProjectLabel : null,
      );
      return;
    }

    if (projects.some((project) => project.id === projectId)) {
      setSelectedProjectName(null);
      return;
    }

    const selectedProjectId = projectId;

    async function fetchSelectedProject() {
      try {
        const response = await getProjectsById({
          client: getBrowserCoreClient(),
          path: { id: selectedProjectId },
          throwOnError: true,
        });
        const selectedProject = response.data?.data;
        if (!selectedProject?.name) {
          return;
        }
        setSelectedProjectName(selectedProject.name);
      } catch {
        setSelectedProjectName(null);
      }
    }

    void fetchSelectedProject();
  }, [projectId, projects, labels.noProjectLabel]);

  useEffect(() => {
    if (!projectId) {
      setTasks([]);
      setTasksNextCursor(null);
      setSelectedTaskName(null);
      return;
    }
    const store = driveStoreForActiveWorkspace(activeOrganizationId);
    const selectedProjectId = projectId;

    const controller = new AbortController();

    async function loadTasks() {
      try {
        const page = await fetchDriveTasksPage({
          scope: store.scope,
          ...(store.scope === "org" && activeOrganizationId
            ? { organizationId: activeOrganizationId }
            : {}),
          projectId: selectedProjectId,
          ...(assigneeId ? { assigneeId } : {}),
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setTasks(mapDriveTasksToTaskOptions(page.items));
          setTasksNextCursor(page.nextCursor);
        }
      } catch {
        if (!controller.signal.aborted) {
          setTasks([]);
          setTasksNextCursor(null);
        }
      }
    }
    void loadTasks();
    return () => {
      controller.abort();
      loadMoreTasksAbortRef.current?.abort();
      loadMoreTasksAbortRef.current = null;
    };
  }, [projectId, activeOrganizationId, assigneeId]);

  useEffect(() => {
    if (!taskId || !projectId) {
      setSelectedTaskName(null);
      return;
    }

    if (tasks.some((task) => task.id === taskId)) {
      setSelectedTaskName(null);
      return;
    }

    const selectedTaskId = taskId;

    async function fetchSelectedTask() {
      try {
        const response = await getTasksById({
          client: getBrowserCoreClient(),
          path: { id: selectedTaskId },
          throwOnError: true,
        });
        const selectedTask = response.data?.data;
        if (!selectedTask?.name) {
          return;
        }
        setSelectedTaskName(selectedTask.name);
      } catch {
        setSelectedTaskName(null);
      }
    }

    void fetchSelectedTask();
  }, [taskId, projectId, tasks]);

  const loadMoreProjects = useCallback(async () => {
    if (!projectsNextCursor || projectsLoadingMore) {
      return;
    }

    const store = driveStoreForActiveWorkspace(activeOrganizationId);
    if (store.scope === "org" && !activeOrganizationId) {
      return;
    }

    loadMoreProjectsAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreProjectsAbortRef.current = controller;
    const cursorAtRequest = projectsNextCursor;

    setProjectsLoadingMore(true);
    try {
      const page = await fetchDriveTasksPage({
        scope: store.scope,
        ...(store.scope === "org" && activeOrganizationId
          ? { organizationId: activeOrganizationId }
          : {}),
        ...(assigneeId ? { assigneeId } : {}),
        cursor: cursorAtRequest,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return;
      }
      const nextPage = mapDriveTasksToProjectOptions(
        page.items,
        labels.noProjectLabel,
      );
      setProjects((current) => [...current, ...nextPage]);
      setProjectsNextCursor(
        resolveNextCursor(page.nextCursor, cursorAtRequest),
      );
    } catch {
      if (!controller.signal.aborted) {
        // Leave the current list intact when pagination fails.
      }
    } finally {
      if (!controller.signal.aborted) {
        setProjectsLoadingMore(false);
      }
    }
  }, [
    activeOrganizationId,
    assigneeId,
    labels.noProjectLabel,
    projectsNextCursor,
    projectsLoadingMore,
  ]);

  const loadMoreTasks = useCallback(async () => {
    if (!projectId || !tasksNextCursor || tasksLoadingMore) {
      return;
    }

    const store = driveStoreForActiveWorkspace(activeOrganizationId);
    if (store.scope === "org" && !activeOrganizationId) {
      return;
    }

    loadMoreTasksAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreTasksAbortRef.current = controller;
    const projectIdAtRequest = projectId;
    const cursorAtRequest = tasksNextCursor;

    setTasksLoadingMore(true);
    try {
      const page = await fetchDriveTasksPage({
        scope: store.scope,
        ...(store.scope === "org" && activeOrganizationId
          ? { organizationId: activeOrganizationId }
          : {}),
        projectId: projectIdAtRequest,
        ...(assigneeId ? { assigneeId } : {}),
        cursor: cursorAtRequest,
        signal: controller.signal,
      });
      if (controller.signal.aborted || projectId !== projectIdAtRequest) {
        return;
      }
      const nextPage = mapDriveTasksToTaskOptions(page.items);
      setTasks((current) => [...current, ...nextPage]);
      setTasksNextCursor(resolveNextCursor(page.nextCursor, cursorAtRequest));
    } catch {
      if (!controller.signal.aborted) {
        // Leave the current list intact when pagination fails.
      }
    } finally {
      if (!controller.signal.aborted && projectId === projectIdAtRequest) {
        setTasksLoadingMore(false);
      }
    }
  }, [
    projectId,
    activeOrganizationId,
    assigneeId,
    tasksNextCursor,
    tasksLoadingMore,
  ]);

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
      icon: Sparkles,
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
      icon: Folder,
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
            loadMoreLabel: labels.loadMore,
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
              loadMoreLabel: labels.loadMore,
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
    selectedProjectName,
    tasks,
    tasksNextCursor,
    tasksLoadingMore,
    selectedTaskName,
    handleFilterChange,
    loadMoreProjects,
    loadMoreTasks,
    labels.all,
    labels.coworkerLabel,
    labels.loadMore,
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
    />
  );
}
