import { Briefcase, ListTodo, type LucideIcon } from "lucide-react";

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
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs">
      <ResourceCountPill
        icon={ListTodo}
        ariaLabel={labels.tasks}
        total={taskCount}
      />
      <ResourceCountPill
        icon={Briefcase}
        ariaLabel={labels.jobs}
        total={jobCount}
      />
    </div>
  );
}

function ResourceCountPill({
  icon: Icon,
  ariaLabel,
  total,
}: {
  icon: LucideIcon;
  ariaLabel: string;
  total: number;
}) {
  return (
    <span
      className="bg-senary text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
      aria-label={`${ariaLabel}: ${total}`}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {total}
    </span>
  );
}
