"use client";

import { ListTodo, Loader2 } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { unassignedWorkspaceTasksQuery } from "@/app/projects/constants";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { coreClient } from "@/lib/clients/core.browser.client";
import { TaskStatus } from "@/lib/clients/generated/core";
import type {
  GetTasksResponse,
  TaskListItem,
} from "@/lib/clients/generated/core/types.gen";

const TASK_PICKER_PAGE_SIZE = 50;

interface ProjectTaskPickerDialogLabels {
  pickerTitle: string;
  pickerDescription: string;
  pickerSearchPlaceholder: string;
  pickerEmpty: string;
  pickerLoading: string;
  pickerError: string;
}

interface ProjectTaskPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdding: boolean;
  pendingTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  labels: ProjectTaskPickerDialogLabels;
}

export function ProjectTaskPickerDialog({
  open,
  onOpenChange,
  isAdding,
  pendingTaskId,
  onSelectTask,
  labels,
}: ProjectTaskPickerDialogProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  const loadTasks = useEffectEvent(async (searchQuery: string) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const response = (await coreClient.getTasks(
        unassignedWorkspaceTasksQuery({
          q: searchQuery || undefined,
          limit: TASK_PICKER_PAGE_SIZE,
        }),
      )) as GetTasksResponse;

      if (requestId !== requestIdRef.current) return;

      setTasks(response.data);
    } catch {
      if (requestId !== requestIdRef.current) return;

      setTasks([]);
      setError(labels.pickerError);
    } finally {
      if (requestId !== requestIdRef.current) return;

      setIsLoading(false);
    }
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [query]);

  useEffect(() => {
    if (!open) return;

    void loadTasks(debouncedQuery);
  }, [debouncedQuery, loadTasks, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setQuery("");
      setDebouncedQuery("");
      setTasks([]);
      setError(null);
      setIsLoading(false);
      requestIdRef.current += 1;
    }

    onOpenChange(nextOpen);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={labels.pickerTitle}
      description={labels.pickerDescription}
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        placeholder={labels.pickerSearchPlaceholder}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {isLoading && tasks.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {labels.pickerLoading}
          </div>
        ) : null}

        {!isLoading && error && tasks.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {error}
          </div>
        ) : null}

        {!isLoading && !error && tasks.length === 0 ? (
          <CommandEmpty>{labels.pickerEmpty}</CommandEmpty>
        ) : null}

        {tasks.length > 0 ? (
          <CommandGroup heading={labels.pickerTitle}>
            {tasks.map((task) => (
              <CommandItem
                key={task.id}
                value={`${task.name} ${task.id}`}
                disabled={isAdding}
                onSelect={() => onSelectTask(task.id)}
              >
                {isAdding && pendingTaskId === task.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <ListTodo className="size-4" aria-hidden />
                )}
                <span className="truncate">{task.name}</span>
                <TaskStatusBadge
                  status={task.status as TaskStatus}
                  className="ml-auto shrink-0"
                />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
