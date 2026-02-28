"use server";

import { feedService } from "@/lib/services";

interface LoadMoreFeedParams {
  jobsCursor: string | null;
  tasksCursor: string | null;
}

export async function loadMoreFeed(params: LoadMoreFeedParams) {
  return feedService.getMyFeedNextPoolPage({
    jobsCursor: params.jobsCursor,
    tasksCursor: params.tasksCursor,
    limitPerSource: 20,
  });
}
