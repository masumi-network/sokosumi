import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface ProjectsLoadingViewLabels {
  newProject: string;
}

interface ProjectsLoadingViewProps {
  labels: ProjectsLoadingViewLabels;
}

export function ProjectsLoadingView({ labels }: ProjectsLoadingViewProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <Button size="sm" className="self-start gap-1.5" disabled>
          <Plus className="size-4" aria-hidden />
          {labels.newProject}
        </Button>
      </div>

      <div className="bg-muted/30 border-border/50 -mx-6 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border">
        <div className="divide-border/50 divide-y px-2">
          {Array.from({ length: 4 }, (_, index) => (
            <ProjectListItemSkeleton key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectListItemSkeleton() {
  return (
    <article className="-mx-2 flex items-center gap-1 rounded-lg px-2">
      <div className="flex min-w-0 flex-1 flex-col gap-2 px-2 py-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Skeleton className="h-5 w-10 rounded-full" />
          <Skeleton className="h-5 w-10 rounded-full" />
        </div>
      </div>

      <div className="shrink-0 pl-2">
        <Skeleton className="size-8 rounded-md" />
      </div>
    </article>
  );
}
