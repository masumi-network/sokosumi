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
  getProjects,
  getProjectsById,
  getTasks,
  getTasksById,
  type ProjectListItem,
  type TaskListItem,
} from "@/lib/clients/generated/core";

const FILTER_PAGE_LIMIT = 100;

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
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectsNextCursor, setProjectsNextCursor] = useState<string | null>(
    null,
  );
  const [projectsLoadingMore, setProjectsLoadingMore] = useState(false);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
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
    async function loadProjects() {
      try {
        const response = await getProjects({
          client: getBrowserCoreClient(),
          query: { limit: FILTER_PAGE_LIMIT },
        });
        setProjects(response.data?.data ?? []);
        setProjectsNextCursor(
          response.data?.meta?.pagination?.nextCursor ?? null,
        );
      } catch {
        setProjects([]);
        setProjectsNextCursor(null);
      }
    }
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!projectId || projectId === "null") {
      setSelectedProjectName(null);
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
  }, [projectId, projects]);

  useEffect(() => {
    if (!projectId) {
      setTasks([]);
      setTasksNextCursor(null);
      setSelectedTaskName(null);
      return;
    }
    const selectedProjectId = projectId;

    const controller = new AbortController();

    async function loadTasks() {
      try {
        const response = await getTasks({
          client: getBrowserCoreClient(),
          query: { projectId: selectedProjectId, limit: FILTER_PAGE_LIMIT },
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setTasks(response.data?.data ?? []);
          setTasksNextCursor(
            response.data?.meta?.pagination?.nextCursor ?? null,
          );
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
  }, [projectId]);

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

    loadMoreProjectsAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreProjectsAbortRef.current = controller;
    const cursorAtRequest = projectsNextCursor;

    setProjectsLoadingMore(true);
    try {
      const response = await getProjects({
        client: getBrowserCoreClient(),
        query: {
          limit: FILTER_PAGE_LIMIT,
          cursor: cursorAtRequest,
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return;
      }
      const nextPage = response.data?.data ?? [];
      setProjects((current) => [...current, ...nextPage]);
      setProjectsNextCursor(
        resolveNextCursor(
          response.data?.meta?.pagination?.nextCursor ?? null,
          cursorAtRequest,
        ),
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
  }, [projectsNextCursor, projectsLoadingMore]);

  const loadMoreTasks = useCallback(async () => {
    if (!projectId || !tasksNextCursor || tasksLoadingMore) {
      return;
    }

    loadMoreTasksAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreTasksAbortRef.current = controller;
    const projectIdAtRequest = projectId;
    const cursorAtRequest = tasksNextCursor;

    setTasksLoadingMore(true);
    try {
      const response = await getTasks({
        client: getBrowserCoreClient(),
        query: {
          projectId: projectIdAtRequest,
          limit: FILTER_PAGE_LIMIT,
          cursor: cursorAtRequest,
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted || projectId !== projectIdAtRequest) {
        return;
      }
      const nextPage = response.data?.data ?? [];
      setTasks((current) => [...current, ...nextPage]);
      setTasksNextCursor(
        resolveNextCursor(
          response.data?.meta?.pagination?.nextCursor ?? null,
          cursorAtRequest,
        ),
      );
    } catch {
      if (!controller.signal.aborted) {
        // Leave the current list intact when pagination fails.
      }
    } finally {
      if (!controller.signal.aborted && projectId === projectIdAtRequest) {
        setTasksLoadingMore(false);
      }
    }
  }, [projectId, tasksNextCursor, tasksLoadingMore]);

  const handleFilterChange = useCallback(
    (param: "assigneeId" | "projectId" | "taskId", value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(param, value);
      } else {
        params.delete(param);
      }

      if (param === "projectId") {
        params.delete("taskId");
      }

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

    if (projectId && tasks.length > 0) {
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
