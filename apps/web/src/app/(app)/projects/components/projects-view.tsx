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
import { ProjectsFilter, type ProjectsFilterLabels } from "./projects-filter";

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
  lastActivity: string;
  created: string;
  filter: ProjectsFilterLabels;
  sortedBy: string;
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
  // An unfiltered, empty workspace has nothing to filter, so the header row
  // would only offer a search over zero projects.
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
        <div className="hidden justify-end md:flex">
          <AddProjectButton label={labels.newProject} className="self-start" />
        </div>

        {hasNothingAtAll ? (
          <ProjectsEmptyState labels={labels.empty} />
        ) : (
          <div
            data-testid="projects-browse"
            className={cn(
              PROJECTS_BROWSE_LAYOUT_CLASS,
              PROJECTS_LIST_CARD_MIN_H_CLASS,
            )}
          >
            {/* Header row of the list card, divided from the rows it labels. */}
            <div className="border-border flex items-center gap-3 border-b px-4 py-2.5">
              <ProjectsFilter labels={labels.filter} />
              {/* Plain text, not a control: the Core route has one fixed
                  ordering, so a chip here would promise a menu that cannot
                  exist yet. */}
              <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
                {labels.sortedBy}
              </span>
            </div>

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

/** Sits inside the list card, under its header row — so no chrome of its own. */
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
        "bg-card-background border-border flex flex-col items-center justify-center rounded-xl border px-6 py-12 text-center",
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
