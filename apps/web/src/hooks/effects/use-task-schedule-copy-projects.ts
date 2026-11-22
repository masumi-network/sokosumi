"use client";

import type { ProjectListItem } from "@sokosumi/core-client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { loadMoreProjects } from "@/app/projects/actions";
import { useTimeout } from "@/hooks/effects/use-timeout";

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
 * only ineligible Projects never reads as "none". It also reads into the next
 * state's first page, so "Show more" only stands for a real further page.
 */
async function loadDestinations(
  from: NonNullable<PageCursor>,
  query: string,
  currentProjectId: string | null,
): Promise<{ projects: ProjectListItem[]; next: PageCursor }> {
  let next: PageCursor = from;
  const projects: ProjectListItem[] = [];
  while (next && (projects.length === 0 || next.cursor === null)) {
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

export interface UseTaskScheduleCopyProjectsResult {
  query: string;
  projects: ProjectListItem[];
  hasNext: boolean;
  isLoading: boolean;
  hasError: boolean;
  loadMore: () => void;
}

/**
 * Loads and paginates eligible copy-destination projects for
 * `TaskScheduleCopyProjectPicker` whenever debounced `search` changes,
 * dropping stale responses by request id.
 */
export function useTaskScheduleCopyProjects(
  currentProjectId: string | null,
  search: string,
): UseTaskScheduleCopyProjectsResult {
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

  useTimeout(() => setQuery(search.trim()), search ? 250 : 0, search);

  useEffect(() => {
    void load(false);
  }, [query]);

  return {
    query,
    projects,
    hasNext: next !== null,
    isLoading,
    hasError,
    loadMore: () => {
      void load(true);
    },
  };
}
