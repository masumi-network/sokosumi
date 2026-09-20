import { Bot, ListTodo, type LucideIcon } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface ProjectResourceCountPillLabels {
  tasks: string;
  jobs: string;
}

interface ProjectResourceCountPillsProps {
  taskCount: number;
  jobCount: number;
  labels: ProjectResourceCountPillLabels;
}

export function ProjectResourceCountPills({
  taskCount,
  jobCount,
  labels,
}: ProjectResourceCountPillsProps) {
  // Both pills drop out at zero, and an empty flex box would still claim its
  // parent's gap — a stray indent before whatever follows the counts.
  if (taskCount === 0 && jobCount === 0) {
    return null;
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs">
      <ResourceCountPill
        icon={ListTodo}
        label={labels.tasks}
        total={taskCount}
      />
      <ResourceCountPill icon={Bot} label={labels.jobs} total={jobCount} />
    </div>
  );
}

/**
 * A zero reads as noise in a list where most projects have none of one kind,
 * so the pill is dropped rather than rendered empty. The icon alone cannot
 * say which kind it counts, hence the tooltip beside the aria-label.
 */
function ResourceCountPill({
  icon: Icon,
  label,
  total,
}: {
  icon: LucideIcon;
  label: string;
  total: number;
}) {
  if (total === 0) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="bg-senary text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
          aria-label={`${label}: ${total}`}
        >
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {total}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
