"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  usePageSearchPagination,
  usePageSearchQuery,
} from "@/components/page-list-search";
import type { TalkingVideoPage } from "@/lib/services/image-studio.service";
import { ACTIVE_STATUSES } from "./tiktok-studio-stage";

const POLL_MS = 4_000;
interface Cursor {
  before: string;
  beforeId: string;
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

  const searching = Boolean(usePageSearchQuery());
  const first = oldestVideo(recent);
  const anchorId = first?.beforeId;
  const historyKey = useMemo(
    () => ["talking-video-history", projectId, anchorId],
    [projectId, anchorId],
  );
  const history = useInfiniteQuery({
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
  useEffect(() => {
    if (!searching)
      void queryClient.cancelQueries({ queryKey: historyKey, exact: true });
  }, [searching, queryClient, historyKey]);
  const lastPage = history.data?.pages.at(-1);
  const cursor = lastPage
    ? history.hasNextPage && oldestVideo(lastPage)
    : first;
  usePageSearchPagination(
    cursor ? cursor.beforeId : null,
    history.isFetching || !history.data,
    history.fetchNextPage,
  );

  const { jobs, assetsByJob } = useMemo(() => {
    const jobs = new Map(recent.jobs.map((job) => [job.id, job]));
    const assetsByJob = new Map(
      recent.assets.map((asset) => [asset.jobId, asset]),
    );
    for (const page of history.data?.pages ?? []) {
      for (const job of page.jobs) if (!jobs.has(job.id)) jobs.set(job.id, job);
      for (const asset of page.assets)
        if (!assetsByJob.has(asset.jobId)) assetsByJob.set(asset.jobId, asset);
    }
    return { jobs: [...jobs.values()], assetsByJob };
  }, [recent, history.data]);
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
    queryKey,
    retry,
  };
}
