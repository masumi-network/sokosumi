"use client";

import { ChevronDown, Loader2 } from "lucide-react";

import { SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskStatus } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import { getTaskStatusPillTone } from "./task-status-badge";

interface TaskStatusPillSelectTriggerProps {
  status: TaskStatus;
  label: string;
  ariaLabel: string;
  isPending?: boolean;
}

export function TaskStatusPillSelectTrigger({
  status,
  label,
  ariaLabel,
  isPending = false,
}: TaskStatusPillSelectTriggerProps) {
  const pillTone = getTaskStatusPillTone(status);

  return (
    <SelectTrigger
      aria-label={ariaLabel}
      className={cn(
        "h-auto w-auto gap-0 rounded-sm border-0 bg-transparent p-0 shadow-none",
        "dark:bg-transparent dark:hover:bg-transparent",
        "data-[size=default]:h-auto",
        "[&>svg]:hidden",
      )}
    >
      <SelectValue>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium",
            pillTone.bg,
            pillTone.text,
          )}
        >
          {isPending ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : null}
          <span>{label}</span>
          <ChevronDown className="size-3 opacity-70" aria-hidden />
        </span>
      </SelectValue>
    </SelectTrigger>
  );
}
