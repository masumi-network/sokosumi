"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";
import { ListMobileCreateFab } from "@/app/components/list-mobile-create-fab";
import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import { loadMoreProjects } from "@/app/projects/actions";
import {
  PROJECTS_BROWSE_CARD_CLASS,
  PROJECTS_BROWSE_HEADER_ROW_CLASS,
  PROJECTS_BROWSE_LIST_CLASS,
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  PROJECTS_OPEN_LAYOUT_CLASS,
  type ProjectsListProject,
  type ProjectsListState,
} from "@/app/projects/constants";
import { PageSearchActions } from "@/components/page-search-actions";
import { Button } from "@/components/ui/button";
import { ButtonLoadingBar } from "@/components/ui/button-loading-bar";
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
  cmo: string;
  /**
   * Each card's menu: Pin or Unpin, Hide or Show, and Close. Its writes
   * revalidate the page, so a new Pin re-sorts the Open view.
   */
  actions: Omit<ProjectDetailActionsLabels, "edit">;
  state: ProjectsStateToggleLabels;
  filter: ProjectsFilterLabels;
  noMatches: string;
  /** A filter with no matches in this view, while another view has some. */
  noMatchesIn: Record<ProjectsListState, string>;
  elsewhere: string;
  showIn: Record<ProjectsListState, string>;
}

interface ListMessage {
  title: string;
  description?: string;
  actions?: { label: string; href: string }[];
}

interface ProjectsViewProps {
  projects: ProjectsListProject[];
  nextCursor: string | null;
  query: string;
  state: ProjectsListState;
  /** Open view only: an empty Open list says so when Closed has projects. */
  hasClosedProjects?: boolean;
  /** Other views the filter matches when this one has none. */
  otherMatches?: ProjectsListState[];
  initialCreateProjectOpen: boolean;
  createProjectModalResetKey: string;
  labels: ProjectsViewLabels;
  /** The Workspace column, beside the grid. The page passes it for Open only. */
  column?: ReactNode;
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
  projects: ProjectsListProject[],
) {
  return `${query}|${state}|${projects
    .map(
      // A close's status changes without touching the project itself.
      (project) =>
        `${project.id}:${project.updatedAt}:${project.starredAt ?? ""}:${JSON.stringify(project.closeStatus ?? null)}`,
    )
    .join("|")}`;
}

export function ProjectsView({
  projects,
  nextCursor,
  query,
  state,
  hasClosedProjects = false,
  otherMatches = [],
  initialCreateProjectOpen,
  createProjectModalResetKey,
  labels,
  column,
}: ProjectsViewProps) {
  const listKey = browseListKey(query, state, projects);
  const [items, setItems] = useState(projects);
  const [cursor, setCursor] = useState(nextCursor);
  const [itemsKey, setItemsKey] = useState(listKey);
  const [isPending, startTransition] = useTransition();
  // The Open/Hidden/Closed switch and the filter refetch on the server; until
  // the new list arrives the old cards stay, so mark them as stale.
  const [isSwitching, startSwitch] = useTransition();
  // Reset appended pages when the server list changes, without remounting
  // the filter (a `key` on this view was stealing focus after every `q`).
  if (itemsKey !== listKey) {
    setItemsKey(listKey);
    setItems(projects);
    setCursor(nextCursor);
  }
  const hasLoadedProjects = items.length > 0;
  const staleClass = cn(
    "transition-opacity duration-150 motion-reduce:transition-none",
    isSwitching && "pointer-events-none opacity-50",
  );
  const isFiltering = query.length > 0;
  const showEmptyState = !hasLoadedProjects && cursor === null;
  const emptyMessage: ListMessage | null = !showEmptyState
    ? null
    : isFiltering
      ? otherMatches.length > 0
        ? {
            title: labels.noMatchesIn[state],
            description: labels.elsewhere,
            actions: otherMatches.map((other) => ({
              label: labels.showIn[other],
              href: projectsHref(other, query),
            })),
          }
        : { title: labels.noMatches }
      : state === "closed"
        ? labels.emptyClosed
        : state === "hidden"
          ? labels.emptyHidden
          : hasClosedProjects
            ? {
                ...labels.onlyClosed,
                actions: [
                  {
                    label: labels.onlyClosed.action,
                    href: projectsHref("closed", ""),
                  },
                ],
              }
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
          <ProjectsStateToggle
            labels={labels.state}
            pending={isSwitching}
            startTransition={startSwitch}
          />
          <PageSearchActions>
            <ProjectsFilter
              labels={labels.filter}
              startTransition={startSwitch}
            />
            <AddProjectButton
              label={labels.newProject}
              className="hidden md:inline-flex"
            />
          </PageSearchActions>
        </div>
        {/* The column comes first in source and on screen: stacked above the
            grid when narrow, on its leading side from xl. */}
        <div className={column ? PROJECTS_OPEN_LAYOUT_CLASS : "contents"}>
          {column}
          <div className="flex min-w-0 flex-col gap-5">
            {/* One panel for the grid and for every empty state, so switching
                views or filtering never swaps the surface under the toolbar. */}
            <div
              data-testid="projects-browse"
              aria-busy={isSwitching || undefined}
              className={cn(
                PROJECTS_BROWSE_CARD_CLASS,
                "relative",
                // Only while there are no cards: a short grid sits in a card that
                // ends with it, as Transactions does, not in a mostly empty well.
                !hasLoadedProjects &&
                  cn(PROJECTS_LIST_CARD_MIN_H_CLASS, "flex flex-col"),
              )}
            >
              {isSwitching ? (
                <ButtonLoadingBar label="" className="top-0 bottom-auto" />
              ) : null}
              {hasLoadedProjects ? (
                <div className={cn(PROJECTS_BROWSE_LIST_CLASS, staleClass)}>
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
                        cmo: labels.cmo,
                        actions: labels.actions,
                      }}
                    />
                  ))}
                </div>
              ) : emptyMessage ? (
                <ProjectsListMessage
                  testId={
                    isFiltering ? "projects-no-matches" : "projects-empty"
                  }
                  message={emptyMessage}
                  className={staleClass}
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
  className,
}: {
  testId: string;
  message: ListMessage;
  className?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center",
        className,
      )}
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
      {message.actions?.length ? (
        <div className="flex flex-wrap justify-center gap-2">
          {message.actions.map((action) => (
            <Button key={action.href} asChild variant="outline">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A view of the list, with the filter kept. Open is the default view. */
function projectsHref(state: ProjectsListState, query: string) {
  const params = new URLSearchParams();
  if (state !== "open") params.set("state", state);
  if (query) params.set("q", query);
  const search = params.toString();
  return search ? `/projects?${search}` : "/projects";
}

function appendUniqueProjects(
  prev: ProjectsListProject[],
  next: ProjectsListProject[],
) {
  const existingIds = new Set(prev.map((project) => project.id));
  const uniqueProjects = next.filter((project) => !existingIds.has(project.id));
  return [...prev, ...uniqueProjects];
}
