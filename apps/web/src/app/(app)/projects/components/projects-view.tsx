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
  PROJECTS_BROWSE_HEADER_ROW_CLASS,
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
import { ProjectsFilter, type ProjectsFilterLabels } from "./projects-filter";

export interface ProjectsViewLabels {
  newProject: string;
  empty: {
    title: string;
    description: string;
  };
  loadMore: string;
  loading: string;
  loadMoreError: string;
  counts: {
    tasks: string;
    jobs: string;
  };
  lastActivity: string;
  created: string;
  pin: string;
  unpin: string;
  pinError: string;
  filter: ProjectsFilterLabels;
  noMatches: string;
}

interface ProjectsViewProps {
  projects: ProjectListItemType[];
  nextCursor: string | null;
  query: string;
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

function browseListKey(query: string, projects: ProjectListItemType[]) {
  return `${query}|${projects
    .map((project) => `${project.id}:${project.updatedAt}`)
    .join("|")}`;
}

export function ProjectsView({
  projects,
  nextCursor,
  query,
  initialCreateProjectOpen,
  createProjectModalResetKey,
  labels,
}: ProjectsViewProps) {
  const listKey = browseListKey(query, projects);
  const [items, setItems] = useState(projects);
  const [cursor, setCursor] = useState(nextCursor);
  const [itemsKey, setItemsKey] = useState(listKey);
  const [isPending, startTransition] = useTransition();
  // Reset appended pages when the server list changes, without remounting
  // the filter (a `key` on this view was stealing focus after every `q`).
  if (itemsKey !== listKey) {
    setItemsKey(listKey);
    setItems(projects);
    setCursor(nextCursor);
  }
  const hasLoadedProjects = items.length > 0;
  const isFiltering = query.length > 0;
  const showEmptyState = !hasLoadedProjects && cursor === null;
  const hasNothingAtAll = showEmptyState && !isFiltering;

  function handleLoadMore() {
    if (!cursor || isPending) return;

    startTransition(async () => {
      try {
        const result = await loadMoreProjects({ cursor, query });
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
        <div
          data-testid="projects-toolbar"
          className={PROJECTS_BROWSE_HEADER_ROW_CLASS}
        >
          <ProjectsFilter labels={labels.filter} />
          <AddProjectButton
            label={labels.newProject}
            className="hidden md:inline-flex"
          />
        </div>
        {hasNothingAtAll ? (
          <ProjectsEmptyState labels={labels.empty} />
        ) : (
          <div
            data-testid="projects-browse"
            className={cn(
              "bg-card-background overflow-hidden rounded-xl",
              PROJECTS_LIST_CARD_MIN_H_CLASS,
            )}
          >
            {hasLoadedProjects ? (
              <div className={PROJECTS_BROWSE_DIVIDE_CLASS}>
                {items.map((project) => (
                  <ProjectListItem
                    key={project.id}
                    project={project}
                    labels={{
                      counts: labels.counts,
                      lastActivity: labels.lastActivity,
                      created: labels.created,
                      pin: labels.pin,
                      unpin: labels.unpin,
                      pinError: labels.pinError,
                    }}
                  />
                ))}
              </div>
            ) : showEmptyState ? (
              <ProjectsNoMatches message={labels.noMatches} />
            ) : null}
          </div>
        )}

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

/** Search feedback stays inside the content group; controls remain above it. */
function ProjectsNoMatches({ message }: { message: string }) {
  return (
    <div
      data-testid="projects-no-matches"
      className="flex flex-col items-center justify-center px-6 py-12 text-center"
    >
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
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
        "bg-card-background flex flex-col items-center justify-center rounded-xl px-6 py-12 text-center",
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
