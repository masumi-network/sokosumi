"use client";

import { ChevronDown, Loader2 } from "lucide-react";

import { SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  STATUS_ROLE_STYLES,
  StatusMarker,
} from "@/components/ui/status-marker";
import { TaskStatus } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import { getTaskStatusMarker } from "./task-status-badge";

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
  const marker = getTaskStatusMarker(status);
  const role = STATUS_ROLE_STYLES[marker.role];

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
            role.bg,
            role.text,
          )}
        >
          {isPending ? (
            <Loader2
              aria-hidden
              // Same box, colour and stroke as the marker it stands in for.
              // A 2px stroke erodes optically on the dark fills, which is why
              // StatusMarker carries 2.25.
              strokeWidth={2.25}
              className={cn(
                "size-3.5 shrink-0 animate-spin motion-reduce:animate-none",
                role.marker,
              )}
            />
          ) : (
            <StatusMarker spec={marker} />
          )}
          <span>{label}</span>
          <ChevronDown className="size-3 opacity-70" aria-hidden />
        </span>
      </SelectValue>
    </SelectTrigger>
  );
}
