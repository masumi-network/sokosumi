import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  Agent,
  Coworker,
  JobSummary,
  TaskEvent,
  TaskListItem,
} from "@/lib/clients/generated/core/types.gen";
import {
  getFirstMarkdownHeading,
  removeFirstMarkdownHeading,
} from "@/lib/utils/feed-helpers";
import { stripMarkdownToText } from "@/lib/utils/strip-markdown";

interface FeedPoolParams {
  limitPerSource?: number;
}

interface FeedNextPoolParams extends FeedPoolParams {
  jobsCursor: string | null;
  tasksCursor: string | null;
}

export interface FeedPoolPage {
  items: FeedItem[];
  jobsCursor: string | null;
  tasksCursor: string | null;
  hasMore: boolean;
}

interface FeedItemBase {
  id: string;
  title: string | null;
  displayTitle: string | null;
  previewText: string | null;
  contentMarkdown: string | null;
  activityAt: string;
  detailHref: string;
}

export interface FeedJobItem extends FeedItemBase {
  type: "job";
  jobId: string;
  agentId: string;
  actor: {
    kind: "agent";
    name: string | null;
    icon: string | null;
  };
}

export interface FeedTaskItem extends FeedItemBase {
  type: "task";
  taskId: string;
  actor: {
    kind: "coworker";
    name: string | null;
    image: string | null;
  };
}

export type FeedItem = FeedJobItem | FeedTaskItem;

function getDateTimestamp(value: Date | string): number {
  return new Date(value).getTime();
}

function getLatestTaskEvent(task: TaskListItem): TaskEvent | null {
  if (task.events.length === 0) {
    return null;
  }

  const [latestEvent] = [...task.events].sort(
    (a, b) => getDateTimestamp(b.updatedAt) - getDateTimestamp(a.updatedAt),
  );

  return latestEvent ?? null;
}

function toFeedJobItems(
  jobs: JobSummary[],
  agentsById: Map<string, Agent | null>,
): FeedJobItem[] {
  return jobs
    .filter((job) => job.status === "completed" && !!job.result)
    .map((job) => {
      const agent = agentsById.get(job.agentId) ?? null;
      const title = job.name?.trim() || null;
      const jobResult = job.result ?? null;
      const headingTitle = getFirstMarkdownHeading(jobResult);
      const previewMarkdown = removeFirstMarkdownHeading(jobResult);
      return {
        type: "job",
        id: `job-${job.id}`,
        jobId: job.id,
        agentId: job.agentId,
        detailHref: `/agents/${job.agentId}/jobs/${job.id}`,
        title,
        displayTitle: headingTitle || title,
        previewText: stripMarkdownToText(previewMarkdown),
        contentMarkdown: jobResult,
        activityAt: new Date(job.completedAt ?? job.updatedAt).toISOString(),
        actor: {
          kind: "agent",
          name: agent?.name?.trim() || null,
          icon: agent?.icon ?? null,
        },
      };
    });
}

function toFeedTaskItems(
  tasks: TaskListItem[],
  coworkersById: Map<string, Coworker>,
): FeedTaskItem[] {
  return tasks
    .filter((task) => task.status === "COMPLETED")
    .map((task) => {
      const latestEvent = getLatestTaskEvent(task);
      const coworker =
        task.coworkerId && coworkersById.has(task.coworkerId)
          ? (coworkersById.get(task.coworkerId) ?? null)
          : null;
      const contentMarkdown = [task.description, latestEvent?.comment]
        .filter((segment): segment is string => Boolean(segment?.trim()))
        .join("\n\n")
        .trim();

      return {
        type: "task",
        id: `task-${task.id}`,
        taskId: task.id,
        detailHref: `/tasks/${task.id}`,
        title: task.name,
        displayTitle: task.name,
        previewText: stripMarkdownToText(contentMarkdown),
        contentMarkdown: contentMarkdown || null,
        activityAt: new Date(
          latestEvent?.updatedAt ?? task.updatedAt,
        ).toISOString(),
        actor: {
          kind: "coworker",
          name: coworker?.name?.trim() || null,
          image: coworker?.image ?? null,
        },
      };
    });
}

export const feedService = (() => {
  async function getAgentsById(
    agentIds: string[],
  ): Promise<Map<string, Agent | null>> {
    const uniqueAgentIds = Array.from(new Set(agentIds));
    const entries = await Promise.all(
      uniqueAgentIds.map(async (agentId) => {
        try {
          const { data } = await coreClient.getAgentById(agentId);
          return [agentId, data] as const;
        } catch {
          return [agentId, null] as const;
        }
      }),
    );

    return new Map(entries);
  }

  async function listFeedItemsPage(params: {
    jobsCursor?: string;
    tasksCursor?: string;
    limitPerSource: number;
    coworkersById: Map<string, Coworker>;
  }): Promise<FeedPoolPage> {
    const [jobsResult, tasksResult] = await Promise.all([
      coreClient.getJobs({
        status: "COMPLETED",
        cursor: params.jobsCursor,
        limit: params.limitPerSource,
      }),
      coreClient.getTasks({
        status: ["COMPLETED"],
        cursor: params.tasksCursor,
        limit: params.limitPerSource,
      }),
    ]);
    const agentsById = await getAgentsById(
      jobsResult.data.map((job) => job.agentId),
    );

    const mergedItems = [
      ...toFeedJobItems(jobsResult.data, agentsById),
      ...toFeedTaskItems(tasksResult.data, params.coworkersById),
    ].sort(
      (a, b) => getDateTimestamp(b.activityAt) - getDateTimestamp(a.activityAt),
    );

    const jobsCursor = jobsResult.meta?.pagination?.nextCursor ?? null;
    const tasksCursor = tasksResult.meta?.pagination?.nextCursor ?? null;

    return {
      items: mergedItems,
      jobsCursor,
      tasksCursor,
      hasMore: Boolean(jobsCursor || tasksCursor),
    };
  }

  async function getMyFeedInitialPool(
    params: FeedPoolParams = {},
  ): Promise<FeedPoolPage> {
    const limitPerSource = params.limitPerSource ?? 20;
    const { data: coworkers } = await coreClient.getCoworkers();
    const coworkersById = new Map(
      coworkers.map((coworker) => [coworker.id, coworker]),
    );
    return listFeedItemsPage({ limitPerSource, coworkersById });
  }

  async function getMyFeedNextPoolPage(
    params: FeedNextPoolParams,
  ): Promise<FeedPoolPage> {
    const limitPerSource = params.limitPerSource ?? 20;
    if (!params.jobsCursor && !params.tasksCursor) {
      return {
        items: [],
        jobsCursor: null,
        tasksCursor: null,
        hasMore: false,
      };
    }

    const { data: coworkers } = await coreClient.getCoworkers();
    const coworkersById = new Map(
      coworkers.map((coworker) => [coworker.id, coworker]),
    );

    const shouldFetchJobs = params.jobsCursor !== null;
    const shouldFetchTasks = params.tasksCursor !== null;

    const [jobsResult, tasksResult] = await Promise.all([
      shouldFetchJobs
        ? coreClient.getJobs({
            status: "COMPLETED",
            cursor: params.jobsCursor ?? undefined,
            limit: limitPerSource,
          })
        : Promise.resolve({
            data: [],
            meta: { pagination: { nextCursor: null } },
          }),
      shouldFetchTasks
        ? coreClient.getTasks({
            status: ["COMPLETED"],
            cursor: params.tasksCursor ?? undefined,
            limit: limitPerSource,
          })
        : Promise.resolve({
            data: [],
            meta: { pagination: { nextCursor: null } },
          }),
    ]);

    const agentsById = await getAgentsById(
      jobsResult.data.map((job) => job.agentId),
    );

    const mergedItems = [
      ...toFeedJobItems(jobsResult.data, agentsById),
      ...toFeedTaskItems(tasksResult.data, coworkersById),
    ].sort(
      (a, b) => getDateTimestamp(b.activityAt) - getDateTimestamp(a.activityAt),
    );

    const jobsCursor = jobsResult.meta?.pagination?.nextCursor ?? null;
    const tasksCursor = tasksResult.meta?.pagination?.nextCursor ?? null;

    return {
      items: mergedItems,
      jobsCursor,
      tasksCursor,
      hasMore: Boolean(jobsCursor || tasksCursor),
    };
  }

  async function getMyFeedItemByFeedId(
    feedId: string,
  ): Promise<FeedItem | null> {
    if (feedId.startsWith("job-")) {
      const jobId = feedId.replace("job-", "");
      try {
        const { data: job } = await coreClient.getJobById(jobId, ["owned"]);
        if (job.status !== "completed" || !job.result) {
          return null;
        }

        const agentsById = await getAgentsById([job.agentId]);
        return toFeedJobItems([job], agentsById).at(0) ?? null;
      } catch {
        return null;
      }
    }

    if (feedId.startsWith("task-")) {
      const taskId = feedId.replace("task-", "");
      try {
        const { data: task } = await coreClient.getTaskById(taskId, ["owned"]);
        if (task.status !== "COMPLETED") {
          return null;
        }

        const { data: coworkers } = await coreClient.getCoworkers();
        const coworkersById = new Map(
          coworkers.map((coworker) => [coworker.id, coworker]),
        );
        return toFeedTaskItems([task], coworkersById).at(0) ?? null;
      } catch {
        return null;
      }
    }

    return null;
  }

  return {
    getMyFeedInitialPool,
    getMyFeedItemByFeedId,
    getMyFeedNextPoolPage,
  };
})();
