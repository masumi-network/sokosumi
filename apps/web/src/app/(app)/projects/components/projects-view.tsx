"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ListMobileCreateFab } from "@/app/components/list-mobile-create-fab";
import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import { loadMoreProjects } from "@/app/projects/actions";
import {
  PROJECTS_BROWSE_DIVIDE_CLASS,
  PROJECTS_BROWSE_LAYOUT_CLASS,
  PROJECTS_LIST_CARD_MIN_H_CLASS,
} from "@/app/projects/constants";
import { Button } from "@/components/ui/button";
import type { ProjectListItem as ProjectListItemType } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";

import { AddProjectButton } from "./add-project-button";
import {
  CreateProjectModal,
  CreateProjectModalProvider,
  useCreateProjectModal,
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

function ProjectsMobileCreateFabSlot() {
  const { handleOpen } = useCreateProjectModal();
  const t = useTranslations("App.Projects");

  return (
    <ListMobileCreateFab
      ariaLabel={t("createProjectFab")}
      onOpen={handleOpen}
    />
  );
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

  return (
    <CreateProjectModalProvider
      key={createProjectModalResetKey}
      initialOpen={initialCreateProjectOpen}
    >
      <div
        className={cn("flex flex-col gap-5", LIST_MOBILE_CREATE_FAB_CLEARANCE)}
      >
        <div className="hidden justify-end md:flex">
          <AddProjectButton label={labels.newProject} className="self-start" />
        </div>

        {hasLoadedProjects ? (
          <div
            data-testid="projects-browse"
            className={cn(
              PROJECTS_BROWSE_LAYOUT_CLASS,
              PROJECTS_LIST_CARD_MIN_H_CLASS,
            )}
          >
            <div className={PROJECTS_BROWSE_DIVIDE_CLASS}>
              {items.map((project) => (
                <ProjectListItem
                  key={project.id}
                  project={project}
                  labels={{ counts: labels.counts }}
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
      <ProjectsMobileCreateFabSlot />
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
    <div
      className={cn(
        "bg-muted/30 border-border/50 flex flex-col items-center justify-center rounded-xl border px-6 py-12 text-center",
        PROJECTS_LIST_CARD_MIN_H_CLASS,
      )}
    >
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
