"use client";

import type { ProjectListItem as ProjectListItemType } from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ListMobileCreateFab } from "@/app/components/list-mobile-create-fab";
import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import { loadMoreProjects } from "@/app/projects/actions";
import {
  PROJECTS_BROWSE_CARD_CLASS,
  PROJECTS_BROWSE_HEADER_ROW_CLASS,
  PROJECTS_BROWSE_LIST_CLASS,
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  type ProjectsListState,
} from "@/app/projects/constants";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { AddProjectButton } from "./add-project-button";
import {
  CreateProjectModal,
  CreateProjectModalProvider,
  useCreateProjectModal,
} from "./create-project-modal";
import type { ProjectDetailActionsLabels } from "./project-detail-actions";
import { ProjectListItem } from "./project-list-item";
import { ProjectsFilter, type ProjectsFilterLabels } from "./projects-filter";
import {
  ProjectsStateToggle,
  type ProjectsStateToggleLabels,
} from "./projects-state-toggle";

export interface ProjectsViewLabels {
  newProject: string;
  empty: {
    title: string;
    description: string;
  };
  emptyClosed: {
    title: string;
    description: string;
  };
  emptyHidden: {
    title: string;
    description: string;
  };
  /** The Open view when every project in the workspace is Closed. */
  onlyClosed: {
    title: string;
    description: string;
    action: string;
  };
  loadMore: string;
  loadMoreError: string;
  counts: {
    tasks: string;
    jobs: string;
  };
  lastActivity: string;
  created: string;
  pinned: string;
  closed: string;
  /**
   * Each card's menu: Pin or Unpin, Hide or Show, and Close. Its writes
   * refresh the page, so a new Pin re-sorts the Open view.
   */
  actions: Omit<ProjectDetailActionsLabels, "edit">;
  state: ProjectsStateToggleLabels;
  filter: ProjectsFilterLabels;
  noMatches: string;
}

interface ProjectsViewProps {
  projects: ProjectListItemType[];
  nextCursor: string | null;
  query: string;
  state: ProjectsListState;
  /** Open view only: an empty Open list says so when Closed has projects. */
  hasClosedProjects?: boolean;
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

function browseListKey(
  query: string,
  state: ProjectsListState,
  projects: ProjectListItemType[],
) {
  return `${query}|${state}|${projects
    .map(
      (project) =>
        `${project.id}:${project.updatedAt}:${project.starredAt ?? ""}`,
    )
    .join("|")}`;
}

export function ProjectsView({
  projects,
  nextCursor,
  query,
  state,
  hasClosedProjects = false,
  initialCreateProjectOpen,
  createProjectModalResetKey,
  labels,
}: ProjectsViewProps) {
  const listKey = browseListKey(query, state, projects);
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
  const emptyMessage = !showEmptyState
    ? null
    : isFiltering
      ? { title: labels.noMatches }
      : state === "closed"
        ? labels.emptyClosed
        : state === "hidden"
          ? labels.emptyHidden
          : hasClosedProjects
            ? labels.onlyClosed
            : labels.empty;

  function handleLoadMore() {
    if (!cursor || isPending) return;

    startTransition(async () => {
      try {
        const result = await loadMoreProjects({ cursor, query, state });
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
          <ProjectsStateToggle labels={labels.state} />
          <AddProjectButton
            label={labels.newProject}
            className="hidden md:inline-flex"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {/* One panel for the grid and for every empty state, so switching
                views or filtering never swaps the surface under the toolbar. */}
          <div
            data-testid="projects-browse"
            className={cn(
              PROJECTS_BROWSE_CARD_CLASS,
              // Only while there are no cards: a short grid sits in a card that
              // ends with it, as Transactions does, not in a mostly empty well.
              !hasLoadedProjects &&
                cn(PROJECTS_LIST_CARD_MIN_H_CLASS, "flex flex-col"),
            )}
          >
            {hasLoadedProjects ? (
              <div className={PROJECTS_BROWSE_LIST_CLASS}>
                {items.map((project) => (
                  <ProjectListItem
                    key={project.id}
                    project={project}
                    hidden={state === "hidden"}
                    labels={{
                      counts: labels.counts,
                      lastActivity: labels.lastActivity,
                      created: labels.created,
                      pinned: labels.pinned,
                      closed: labels.closed,
                      actions: labels.actions,
                    }}
                  />
                ))}
              </div>
            ) : emptyMessage ? (
              <ProjectsListMessage
                testId={isFiltering ? "projects-no-matches" : "projects-empty"}
                message={emptyMessage}
              />
            ) : null}
          </div>

          {cursor ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                loading={isPending}
              >
                {labels.loadMore}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <ProjectsMobileCreateFabSlot />
      <CreateProjectModal />
    </CreateProjectModalProvider>
  );
}

/**
 * Empty and no-match feedback, centred in the grid's own panel; the toolbar
 * above keeps search, the view switch and create reachable.
 */
function ProjectsListMessage({
  testId,
  message,
}: {
  testId: string;
  message: { title: string; description?: string; action?: string };
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center"
    >
      <div className="max-w-sm">
        <h2 className="text-foreground text-base font-semibold text-balance">
          {message.title}
        </h2>
        {message.description ? (
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            {message.description}
          </p>
        ) : null}
      </div>
      {message.action ? (
        <Button asChild variant="outline">
          <Link href="/projects?state=closed">{message.action}</Link>
        </Button>
      ) : null}
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
