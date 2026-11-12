"use client";

import type { ProjectListItem } from "@sokosumi/core-client";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { loadMoreProjects } from "@/app/projects/actions";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

/** Open first, then the viewer's Hidden ones: both take new schedules. */
const DESTINATION_STATES = ["open", "hidden"] as const;

/** Where the next page comes from; `null` once every state is read. */
type PageCursor = {
  stateIndex: number;
  cursor: string | null;
} | null;

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
 * only ineligible Projects never reads as "none".
 */
async function loadDestinations(
  from: NonNullable<PageCursor>,
  query: string,
  currentProjectId: string | null,
): Promise<{ projects: ProjectListItem[]; next: PageCursor }> {
  let next: PageCursor = from;
  const projects: ProjectListItem[] = [];
  while (next && projects.length === 0) {
    const page = await loadMoreProjects({
      cursor: next.cursor,
      query: query || undefined,
      state: DESTINATION_STATES[next.stateIndex],
    });
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
  currentProjectId,
  onSelect,
  onClose,
}: {
  currentProjectId: string | null;
  onSelect: (projectId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("App.Tasks.Schedules.Actions");
  const tNewTask = useTranslations("App.Tasks.NewTask");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [next, setNext] = useState<PageCursor>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const requestIdRef = useRef(0);

  const load = useEffectEvent(async (append: boolean) => {
    const from = append ? next : { stateIndex: 0, cursor: null };
    if (!from) return;
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setHasError(false);
    try {
      const page = await loadDestinations(from, query, currentProjectId);
      if (requestId !== requestIdRef.current) return;
      setProjects((current) =>
        append ? [...current, ...page.projects] : page.projects,
      );
      setNext(page.next);
    } catch {
      if (requestId !== requestIdRef.current) return;
      if (!append) setProjects([]);
      setHasError(true);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setQuery(search.trim()),
      search ? 250 : 0,
    );
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    void load(false);
  }, [query]);

  const status = hasError
    ? t("copyToProjectFailed")
    : isLoading && projects.length === 0
      ? t("copyToProjectLoading")
      : null;

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
        onValueChange={setSearch}
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
                onSelect={() => onSelect(project.id)}
              >
                <ProjectAvatar
                  name={project.name}
                  logo={project.logo}
                  className="size-5 shrink-0"
                />
                <span className="truncate">{project.name}</span>
              </CommandItem>
            ))}
            {next ? (
              <CommandItem
                value="load-more"
                disabled={isLoading}
                onSelect={() => void load(true)}
              >
                {isLoading ? (
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
