"use client";

import { Folder, ListCheck, Sparkles } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import {
  type Coworker,
  getCoworkers,
  getProjects,
  getTasks,
  type ProjectListItem,
  type TaskListItem,
} from "@/lib/clients/generated/core";

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
  };
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
  const [tasks, setTasks] = useState<TaskListItem[]>([]);

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
          query: { limit: 100 },
        });
        setProjects(response.data?.data ?? []);
      } catch {
        setProjects([]);
      }
    }
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!projectId) {
      setTasks([]);
      return;
    }
    const selectedProjectId = projectId;

    const controller = new AbortController();

    async function loadTasks() {
      try {
        const response = await getTasks({
          client: getBrowserCoreClient(),
          query: { projectId: selectedProjectId, limit: 100 },
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setTasks(response.data?.data ?? []);
        }
      } catch {
        if (!controller.signal.aborted) {
          setTasks([]);
        }
      }
    }
    void loadTasks();
    return () => {
      controller.abort();
    };
  }, [projectId]);

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
      options: projects.map((project) => ({
        value: project.id,
        label: project.name,
      })),
    });

    if (projectId && tasks.length > 0) {
      nextSections.push({
        id: "task",
        label: labels.taskLabel,
        icon: ListCheck,
        value: taskId,
        allLabel: labels.all,
        onChange: (value) => handleFilterChange("taskId", value),
        options: tasks.map((task) => ({
          value: task.id,
          label: task.name,
        })),
      });
    }

    return nextSections;
  }, [
    assigneeId,
    projectId,
    taskId,
    coworkers,
    projects,
    tasks,
    handleFilterChange,
    labels.all,
    labels.coworkerLabel,
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
