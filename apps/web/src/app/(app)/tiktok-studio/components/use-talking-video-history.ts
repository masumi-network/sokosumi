"use client";

import {
  type InfiniteData,
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  usePageSearchPagination,
  usePageSearchQuery,
} from "@/components/page-list-search";
import { useTalkingVideoHistoryCancel } from "@/hooks/effects/use-talking-video-history-cancel";
import type { TalkingVideoPage } from "@/lib/services/image-studio.service";
import { rankPageItems } from "@/lib/utils/page-search";
import { ACTIVE_STATUSES } from "./tiktok-studio-stage";

const POLL_MS = 4_000;
interface Cursor {
  before: string;
  beforeId: string;
}

type History = InfiniteData<TalkingVideoPage, Cursor | undefined>;
type VideoJob = TalkingVideoPage["jobs"][number];
interface HistoryPage {
  cursor: Cursor;
  page: TalkingVideoPage;
}

export function talkingVideoSearchFields(job: VideoJob) {
  return {
    primary: [job.prompt, job.id],
    secondary: [job.status, job.model, job.kind],
  };
}

function oldestVideo(page: TalkingVideoPage): Cursor | undefined {
  if (!page.hasMore) return undefined;
  const last = page.jobs.at(-1);
  return (
    last && {
      before: new Date(last.createdAt).toISOString(),
      beforeId: last.id,
    }
  );
}

async function fetchTalkingVideos(
  projectId: string,
  signal: AbortSignal,
  cursor?: Cursor,
): Promise<TalkingVideoPage> {
  const params = cursor ? `?${new URLSearchParams({ ...cursor })}` : "";
  const response = await fetch(
    `/api/projects/${projectId}/image-studio/talking-videos${params}`,
    { credentials: "same-origin", signal },
  );
  if (!response.ok) throw new Error("Talking videos unavailable");
  return response.json();
}

export function useTalkingVideoHistory(
  projectId: string,
  initialVideos: TalkingVideoPage,
  selectedId: string | null,
) {
  const queryClient = useQueryClient();
  const queryKey = ["talking-videos", projectId];
  const { data: recent } = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchTalkingVideos(projectId, signal),
    initialData: initialVideos,
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => ACTIVE_STATUSES.has(job.status))
        ? POLL_MS
        : false,
  });

  const term = usePageSearchQuery();
  const searching = Boolean(term);
  const first = oldestVideo(recent);
  const anchorId = first?.beforeId;
  const historyKey = useMemo(
    () => ["talking-video-history", projectId, anchorId],
    [projectId, anchorId],
  );
  const history = useInfiniteQuery<
    TalkingVideoPage,
    Error,
    History,
    typeof historyKey,
    Cursor | undefined
  >({
    queryKey: historyKey,
    initialPageParam: first,
    enabled: searching && Boolean(first),
    staleTime: Infinity,
    queryFn: ({ pageParam, signal }) =>
      fetchTalkingVideos(projectId, signal, pageParam),
    getNextPageParam: (page, _pages, previous) => {
      const next = oldestVideo(page);
      return next?.beforeId === previous?.beforeId ? undefined : next;
    },
  });
  useTalkingVideoHistoryCancel({ searching, queryClient, historyKey });
  const lastPage = history.data?.pages.at(-1);
  const cursor = lastPage
    ? history.hasNextPage && oldestVideo(lastPage)
    : first;
  usePageSearchPagination(
    cursor ? cursor.beforeId : null,
    history.isFetching || !history.data,
    history.fetchNextPage,
  );

  const [pinned, setPinned] = useState<(HistoryPage & { id: string }) | null>(
    null,
  );
  const pages = useMemo(
    () =>
      history.data?.pages.flatMap((page, index) => {
        const cursor = history.data.pageParams[index];
        return cursor ? [{ cursor, page }] : [];
      }) ?? [],
    [history.data],
  );
  const selected = pinned?.id === selectedId ? pinned : null;
  const needsUpdate = (page: TalkingVideoPage) => {
    const active = page.jobs.filter((job) => ACTIVE_STATUSES.has(job.status));
    if (!active.length) return false;
    return (
      active.some((job) => job.id === selectedId) ||
      Boolean(
        term && rankPageItems(active, term, talkingVideoSearchFields).length,
      )
    );
  };
  const observed = pages.filter(({ page }) => needsUpdate(page));
  if (
    selected &&
    !observed.some(({ cursor }) => cursor.beforeId === selected.cursor.beforeId)
  ) {
    observed.push(selected);
  }
  const updatesByCursor = useQueries({
    queries: observed.map(({ cursor, page }) => ({
      queryKey: ["talking-video-status", projectId, cursor.beforeId],
      initialData: page,
      staleTime: Infinity,
      refetchInterval: (query: { state: { data?: TalkingVideoPage } }) =>
        query.state.data && needsUpdate(query.state.data)
          ? POLL_MS
          : (false as const),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        // The newest-page read settles provider jobs. Concurrent page polls share that read.
        await queryClient.fetchQuery({
          queryKey,
          queryFn: ({ signal }) => fetchTalkingVideos(projectId, signal),
          staleTime: POLL_MS,
        });
        const updated = await fetchTalkingVideos(projectId, signal, cursor);
        queryClient.setQueriesData<History>(
          { queryKey: ["talking-video-history", projectId] },
          (previous) => {
            const index =
              previous?.pageParams.findIndex(
                (param) => param?.beforeId === cursor.beforeId,
              ) ?? -1;
            return previous && index >= 0
              ? {
                  ...previous,
                  pages: previous.pages.map((old, i) =>
                    i === index ? updated : old,
                  ),
                }
              : previous;
          },
        );
        return updated;
      },
    })),
    combine: (results) =>
      Object.fromEntries(
        results.map(({ data }, index) => [
          observed[index].cursor.beforeId,
          data,
        ]),
      ),
  });

  const withSelection = useMemo(
    () =>
      selected &&
      !pages.some(({ cursor }) => cursor.beforeId === selected.cursor.beforeId)
        ? [...pages, selected]
        : pages,
    [pages, selected],
  );
  function pinSelection(id: string | null) {
    const source = withSelection.find(({ page }) =>
      page.jobs.some((job) => job.id === id),
    );
    setPinned(id && source ? { ...source, id } : null);
  }

  const { jobs, assetsByJob } = useMemo(() => {
    const jobs = new Map(recent.jobs.map((job) => [job.id, job]));
    const assetsByJob = new Map(
      recent.assets.map((asset) => [asset.jobId, asset]),
    );
    for (const { cursor, page: cached } of withSelection) {
      const page = updatesByCursor[cursor.beforeId] ?? cached;
      for (const job of page.jobs) if (!jobs.has(job.id)) jobs.set(job.id, job);
      for (const asset of page.assets)
        if (!assetsByJob.has(asset.jobId)) assetsByJob.set(asset.jobId, asset);
    }
    return { jobs: [...jobs.values()], assetsByJob };
  }, [recent, withSelection, updatesByCursor]);
  const retry =
    searching && history.isError
      ? () =>
          void (history.isFetchNextPageError
            ? history.fetchNextPage()
            : history.refetch())
      : undefined;
  return {
    jobs,
    assetsByJob,
    libraryJobs: searching ? jobs : recent.jobs,
    pinSelection,
    queryKey,
    retry,
  };
}
