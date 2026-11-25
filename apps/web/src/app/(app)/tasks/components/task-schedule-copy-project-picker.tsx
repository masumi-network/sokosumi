"use client";

import type { ProjectListItem } from "@sokosumi/core-client";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { loadMoreProjects } from "@/app/projects/actions";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useScopedInfiniteQuery } from "@/queries/scoped-queries";

/** Open first, then the viewer's Hidden ones: both take new schedules. */
const DESTINATION_STATES = ["open", "hidden"] as const;
const PROJECT_PICKER_SEARCH_DEBOUNCE_MS = 250;

let nextOpeningId = 0;

type ProjectPickerScope = readonly [
  workspaceId: string,
  organizationId: string | null,
  viewerId: string | null,
];

/** Where the next page comes from; `null` once every state is read. */
type PageCursor = {
  stateIndex: number;
  cursor: string | null;
} | null;

const INITIAL_PAGE_CURSOR: NonNullable<PageCursor> = {
  stateIndex: 0,
  cursor: null,
};

/** A Project a schedule may be copied into: not its own, CMO, closing or closed. */
export function isCopyDestination(
  project: ProjectListItem,
  currentProjectId: string | null,
): boolean {
  return (
    project.id !== currentProjectId &&
    !project.cmo &&
    !project.closingAt &&
    !project.closedAt
  );
}

/**
 * Reads pages until one holds a destination or none are left, so a page of
 * only ineligible Projects never reads as "none". It also reads into the next
 * state's first page, so "Show more" only stands for a real further page.
 */
async function loadDestinations(
  from: NonNullable<PageCursor>,
  query: string,
  currentProjectId: string | null,
  scope: ProjectPickerScope,
  signal: AbortSignal,
): Promise<{ projects: ProjectListItem[]; next: PageCursor }> {
  const [expectedWorkspaceId, expectedOrganizationId, expectedViewerId] = scope;
  let next: PageCursor = from;
  const projects: ProjectListItem[] = [];
  while (next && (projects.length === 0 || next.cursor === null)) {
    signal.throwIfAborted();
    const page = await loadMoreProjects({
      cursor: next.cursor,
      query: query || undefined,
      state: DESTINATION_STATES[next.stateIndex],
      expectedOrganizationId,
      ...(expectedViewerId ? { expectedViewerId } : {}),
    });
    signal.throwIfAborted();
    if (
      page.projects.some(
        (project) =>
          project.workspaceId && project.workspaceId !== expectedWorkspaceId,
      )
    ) {
      throw new Error("Active workspace changed");
    }
    projects.push(
      ...page.projects.filter((project) =>
        isCopyDestination(project, currentProjectId),
      ),
    );
    next = page.nextCursor
      ? { stateIndex: next.stateIndex, cursor: page.nextCursor }
      : next.stateIndex + 1 < DESTINATION_STATES.length
        ? { stateIndex: next.stateIndex + 1, cursor: null }
        : null;
  }
  return { projects, next };
}

/** First step of "Copy to another Project": choose where the copy goes. */
export function TaskScheduleCopyProjectPicker({
  workspaceId,
  organizationId,
  viewerId = null,
  currentProjectId,
  onSelect,
  onClose,
}: {
  workspaceId: string;
  organizationId: string | null;
  viewerId?: string | null;
  currentProjectId: string | null;
  onSelect: (project: ProjectFilterOption) => void;
  onClose: () => void;
}) {
  const t = useTranslations("App.Tasks.Schedules.Actions");
  const tNewTask = useTranslations("App.Tasks.NewTask");
  const [openingId] = useState(() => ++nextOpeningId);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const debouncedSetQuery = useDebouncedCallback((value: string) => {
    setQuery(value);
  }, PROJECT_PICKER_SEARCH_DEBOUNCE_MS);
  const scope: ProjectPickerScope = [workspaceId, organizationId, viewerId];

  function handleSearchChange(value: string) {
    setSearch(value);
    const trimmed = value.trim();
    if (!trimmed) {
      debouncedSetQuery.cancel();
      setQuery("");
      return;
    }
    debouncedSetQuery(trimmed);
  }

  const {
    data,
    error,
    hasNextPage,
    isPending,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
  } = useScopedInfiniteQuery({
    scope,
    queryKey: [
      "task-schedule-copy-project-picker",
      openingId,
      { query, currentProjectId },
    ],
    initialPageParam: INITIAL_PAGE_CURSOR,
    queryFn: ({ pageParam, signal, queryKey }) => {
      const [queryScope] = queryKey;
      return loadDestinations(
        pageParam,
        query,
        currentProjectId,
        queryScope,
        signal,
      );
    },
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
    staleTime: 0,
    gcTime: 0,
  });

  const projects = data?.pages.flatMap((page) => page.projects) ?? [];
  const hasError = Boolean(error) && !isFetching;
  const isInitialLoading =
    isPending ||
    (Boolean(error) &&
      isFetching &&
      !isFetchingNextPage &&
      projects.length === 0);

  const status = hasError
    ? t("copyToProjectFailed")
    : isInitialLoading && projects.length === 0
      ? t("copyToProjectLoading")
      : null;

  function handleLoadMore() {
    if (!hasNextPage || isFetchingNextPage || isFetching) {
      return;
    }

    void fetchNextPage();
  }

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("copyToProjectTitle")}
      description={t("copyToProjectDescription")}
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        placeholder={tNewTask("projectSearchPlaceholder")}
        value={search}
        onValueChange={handleSearchChange}
      />
      <CommandList>
        {status ? (
          <p
            role="status"
            className="text-muted-foreground px-4 py-6 text-center text-sm"
          >
            {status}
          </p>
        ) : projects.length === 0 ? (
          <CommandEmpty>
            {query ? tNewTask("projectEmptyResults") : t("copyToProjectNone")}
          </CommandEmpty>
        ) : null}
        {projects.length > 0 ? (
          <CommandGroup heading={t("copyToProjectTitle")}>
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={project.id}
                onSelect={() =>
                  onSelect({
                    id: project.id,
                    name: project.name,
                    logo: project.logo,
                  })
                }
              >
                <ProjectAvatar
                  name={project.name}
                  logo={project.logo}
                  className="size-5 shrink-0"
                />
                <span className="truncate">{project.name}</span>
              </CommandItem>
            ))}
            {hasNextPage ? (
              <CommandItem
                value="load-more"
                disabled={isFetchingNextPage || isFetching}
                onSelect={handleLoadMore}
              >
                {isFetchingNextPage ? (
                  <Loader2
                    className="size-4 animate-spin motion-reduce:animate-pulse"
                    aria-hidden
                  />
                ) : null}
                <span>{t("copyToProjectLoadMore")}</span>
              </CommandItem>
            ) : null}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
