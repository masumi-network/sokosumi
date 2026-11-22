"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { loadCreateTaskModalData } from "@/app/tasks/actions";
import type { TaskFormInitialDesignMdAttachment } from "@/app/tasks/components/task-form";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";

export interface LoadedCreateTaskModalData {
  agentNameById: Map<string, string>;
  designMdAttachment: TaskFormInitialDesignMdAttachment | null;
  projectOptions: ProjectFilterOption[];
}

export interface UseCreateTaskModalDataOptions {
  ownsCreateData: boolean;
  isLoadingOptions: boolean;
  open: boolean;
  initialCreateTaskOpen: boolean;
  tTasksErrors: (key: "loadCreateTask") => string;
}

/**
 * Lazily loads agent names, design.md attachment, and project options when
 * `CreateTaskModal` opens without caller-owned create data.
 */
export function useCreateTaskModalData({
  ownsCreateData,
  isLoadingOptions,
  open,
  initialCreateTaskOpen,
  tTasksErrors,
}: UseCreateTaskModalDataOptions): LoadedCreateTaskModalData | null {
  const [loadedCreateData, setLoadedCreateData] =
    useState<LoadedCreateTaskModalData | null>(null);

  useEffect(() => {
    if (ownsCreateData || isLoadingOptions) return;
    if (!open && !initialCreateTaskOpen) return;
    if (loadedCreateData) return;

    let cancelled = false;
    void loadCreateTaskModalData()
      .then((data) => {
        if (cancelled) return;
        setLoadedCreateData({
          agentNameById: new Map(Object.entries(data.agentNameById)),
          designMdAttachment: data.designMdAttachment,
          projectOptions: data.projectOptions,
        });
      })
      .catch(() => {
        if (cancelled) return;
        toast.error(tTasksErrors("loadCreateTask"));
      });

    return () => {
      cancelled = true;
    };
  }, [
    initialCreateTaskOpen,
    isLoadingOptions,
    loadedCreateData,
    open,
    ownsCreateData,
    tTasksErrors,
  ]);

  return loadedCreateData;
}
