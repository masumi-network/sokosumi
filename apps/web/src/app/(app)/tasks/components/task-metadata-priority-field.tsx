"use client";

import { TaskPriority } from "@sokosumi/core-client";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { setTaskPriority } from "@/lib/actions/task/action";
import { cn } from "@/lib/utils";

import { TaskPriorityIcon } from "./task-priority-icon";
import { ROW_TRIGGER_CLASS } from "./task-status-picker";

export interface TaskPriorityLabels {
  /** Field name, prefixed to the trigger's accessible name: "Priority: High". */
  priority: string;
  levels: Record<TaskPriority, string>;
  changePriority: string;
  noPriorityMatches: string;
  updateError: string;
}

/** Declaration order in Core is urgent first, none last. */
export const TASK_PRIORITIES = Object.values(TaskPriority);

interface TaskMetadataPriorityFieldProps {
  taskId: string;
  priority: TaskPriority;
  labels: TaskPriorityLabels;
}

export function TaskMetadataPriorityField({
  taskId,
  priority,
  labels,
}: TaskMetadataPriorityFieldProps) {
  const router = useRouter();
  const [current, setCurrent] = useState(priority);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSelect(next: TaskPriority) {
    setOpen(false);
    if (next === current) return;

    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      try {
        const result = await setTaskPriority({ taskId, priority: next });
        if (!result.ok) {
          setCurrent(previous);
          toast.error(labels.updateError);
          return;
        }
        router.refresh();
      } catch (error) {
        console.error("Failed to update task priority", error);
        setCurrent(previous);
        toast.error(labels.updateError);
      }
    });
  }

  const ariaLabel = `${labels.priority}: ${labels.levels[current]}`;

  const trigger = (
    <PopoverTrigger asChild>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={isPending}
        className={cn(
          "focus-visible:ring-ring-halo focus-visible:inset-ring-1 focus-visible:inset-ring-ring outline-none focus-visible:ring-2 disabled:cursor-not-allowed",
          ROW_TRIGGER_CLASS,
        )}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          <TaskPriorityIcon priority={current} />
        </span>
        <span
          className={cn(
            "truncate",
            current === "NONE" && "text-muted-foreground",
          )}
        >
          {labels.levels[current]}
        </span>
      </button>
    </PopoverTrigger>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side="left">{ariaLabel}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput
            autoFocus
            hideIcon
            placeholder={labels.changePriority}
          />
          <CommandList className="p-1">
            <CommandEmpty>{labels.noPriorityMatches}</CommandEmpty>
            {TASK_PRIORITIES.map((level) => (
              <CommandItem
                key={level}
                value={level}
                keywords={[labels.levels[level]]}
                data-current={level === current || undefined}
                onSelect={() => handleSelect(level)}
              >
                <TaskPriorityIcon priority={level} />
                <span className="flex-1 truncate">{labels.levels[level]}</span>
                {level === current ? (
                  <Check className="size-4" aria-hidden />
                ) : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
