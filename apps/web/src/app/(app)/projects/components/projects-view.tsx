"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { loadMoreProjects } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import type { ProjectListItem as ProjectListItemType } from "@/lib/clients/generated/core/types.gen";

import { AddProjectButton } from "./add-project-button";
import {
  CreateProjectModal,
  CreateProjectModalProvider,
} from "./create-project-modal";
import { ProjectListItem } from "./project-list-item";

export interface ProjectsViewLabels {
  newProject: string;
  empty: {
    title: string;
    description: string;
    action: string;
  };
  loadMore: string;
  loading: string;
  loadMoreError: string;
  rowActions: {
    moreActions: string;
    viewDetails: string;
    edit: string;
    delete: string;
  };
  deleteDialog: {
    title: string;
    description: string;
    confirm: string;
    cancel: string;
    error: string;
  };
  counts: {
    tasks: string;
    jobs: string;
  };
}

interface ProjectsViewProps {
  projects: ProjectListItemType[];
  nextCursor: string | null;
  initialCreateProjectOpen: boolean;
  createProjectModalResetKey: string;
  labels: ProjectsViewLabels;
}

export function ProjectsView({
  projects,
  nextCursor,
  initialCreateProjectOpen,
  createProjectModalResetKey,
  labels,
}: ProjectsViewProps) {
  const [items, setItems] = useState(projects);
  const [cursor, setCursor] = useState(nextCursor);
  const [isPending, startTransition] = useTransition();
  const hasLoadedProjects = items.length > 0;
  const showEmptyState = !hasLoadedProjects && cursor === null;
  const rowLabels = {
    actions: labels.rowActions,
    deleteDialog: labels.deleteDialog,
    counts: labels.counts,
  };

  function handleLoadMore() {
    if (!cursor || isPending) return;

    startTransition(async () => {
      try {
        const result = await loadMoreProjects({ cursor });
        setItems((prev) => appendUniqueProjects(prev, result.projects));
        setCursor(result.nextCursor);
      } catch {
        toast.error(labels.loadMoreError);
      }
    });
  }

  function handleProjectDeleted(projectId: string) {
    setItems((prev) => prev.filter((project) => project.id !== projectId));
  }

  return (
    <CreateProjectModalProvider
      key={createProjectModalResetKey}
      initialOpen={initialCreateProjectOpen}
    >
      <div className="flex flex-col gap-5">
        <div className="flex justify-end">
          <AddProjectButton label={labels.newProject} className="self-start" />
        </div>

        {hasLoadedProjects ? (
          <div className="bg-muted/30 border-border/50 -mx-6 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border">
            <div className="divide-border/50 divide-y px-2">
              {items.map((project) => (
                <ProjectListItem
                  key={project.id}
                  project={project}
                  labels={rowLabels}
                  onDeleted={handleProjectDeleted}
                />
              ))}
            </div>
          </div>
        ) : showEmptyState ? (
          <ProjectsEmptyState labels={labels.empty} />
        ) : null}

        {cursor ? (
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={handleLoadMore}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {labels.loading}
                </>
              ) : (
                labels.loadMore
              )}
            </Button>
          </div>
        ) : null}
      </div>
      <CreateProjectModal />
    </CreateProjectModalProvider>
  );
}

function ProjectsEmptyState({
  labels,
}: {
  labels: ProjectsViewLabels["empty"];
}) {
  return (
    <div className="bg-muted/30 border-border/50 flex min-h-[320px] flex-col items-center justify-center rounded-xl border px-6 py-12 text-center">
      <div className="max-w-sm">
        <h2 className="text-foreground text-lg font-semibold">
          {labels.title}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {labels.description}
        </p>
        <AddProjectButton label={labels.action} className="mt-6" />
      </div>
    </div>
  );
}

function appendUniqueProjects(
  prev: ProjectListItemType[],
  next: ProjectListItemType[],
) {
  const existingIds = new Set(prev.map((project) => project.id));
  const uniqueProjects = next.filter((project) => !existingIds.has(project.id));
  return [...prev, ...uniqueProjects];
}
