import { AgentJobStatus, JobType, TaskStatus } from "@sokosumi/database";
import {
  computeJobStatus,
  isJobStatusSettled,
} from "@sokosumi/database/helpers";
import { jobForStatusComputeSelect } from "@sokosumi/database/types/job";
import { SokosumiJobStatus } from "@sokosumi/utils";

import { loadAgentPreviewsByIds } from "@/helpers/history";
import prisma from "@/lib/db/prisma";
import type { HistoryItem } from "@/schemas/history.schema";
import {
  PROJECT_NEEDS_ATTENTION_LIMIT,
  type ProjectNeedsAttention,
  projectNeedsAttentionSchema,
} from "@/schemas/project.schema";
import { createProjectListCountsInclude } from "@/types/project";

/** Lower is more urgent. Exclude is not a tier — those rows never enter the list. */
export const NeedsAttentionTier = {
  mustAct: 0,
  failed: 1,
  inFlight: 2,
} as const;

export type NeedsAttentionTier =
  (typeof NeedsAttentionTier)[keyof typeof NeedsAttentionTier];

type AttentionClass = "must_act" | "failed" | "in_flight" | "exclude";

const TASK_ATTENTION_CLASS = {
  GRANT_PENDING: "must_act",
  INPUT_REQUIRED: "must_act",
  APPROVAL_REQUIRED: "must_act",
  AUTHENTICATION_REQUIRED: "must_act",
  OUT_OF_CREDITS: "must_act",
  FAILED: "failed",
  RUNNING: "in_flight",
  AWAITING_EXTERNAL: "in_flight",
  DRAFT: "exclude",
  QUEUED: "exclude",
  READY: "exclude",
  CREDITS_TOPPED_UP: "exclude",
  COMPLETED: "exclude",
  CANCELED: "exclude",
} as const satisfies Record<TaskStatus, AttentionClass>;

const JOB_ATTENTION_CLASS = {
  [SokosumiJobStatus.INPUT_REQUIRED]: "must_act",
  [SokosumiJobStatus.PAYMENT_PENDING]: "must_act",
  [SokosumiJobStatus.PAYMENT_FAILED]: "must_act",
  [SokosumiJobStatus.FAILED]: "failed",
  [SokosumiJobStatus.DISPUTE_PENDING]: "failed",
  [SokosumiJobStatus.STARTED]: "in_flight",
  [SokosumiJobStatus.PROCESSING]: "in_flight",
  [SokosumiJobStatus.RESULT_PENDING]: "in_flight",
  [SokosumiJobStatus.COMPLETED]: "exclude",
  [SokosumiJobStatus.REFUND_PENDING]: "exclude",
  [SokosumiJobStatus.REFUND_RESOLVED]: "exclude",
  [SokosumiJobStatus.DISPUTE_RESOLVED]: "exclude",
} as const satisfies Record<SokosumiJobStatus, AttentionClass>;

const TIER_BY_CLASS: Record<
  Exclude<AttentionClass, "exclude">,
  NeedsAttentionTier
> = {
  must_act: NeedsAttentionTier.mustAct,
  failed: NeedsAttentionTier.failed,
  in_flight: NeedsAttentionTier.inFlight,
};

export const TASK_ATTENTION_STATUSES = Object.entries(TASK_ATTENTION_CLASS)
  .filter(([, attentionClass]) => attentionClass !== "exclude")
  .map(([status]) => status as TaskStatus);

export function taskNeedsAttentionTier(
  status: TaskStatus,
): NeedsAttentionTier | null {
  const attentionClass = TASK_ATTENTION_CLASS[status];
  return attentionClass === "exclude" ? null : TIER_BY_CLASS[attentionClass];
}

export function jobNeedsAttentionTier(
  status: SokosumiJobStatus,
): NeedsAttentionTier | null {
  const attentionClass = JOB_ATTENTION_CLASS[status];
  return attentionClass === "exclude" ? null : TIER_BY_CLASS[attentionClass];
}

export interface RankableAttentionItem {
  id: string;
  kind: "task" | "job";
  tier: NeedsAttentionTier;
  updatedAtMs: number;
}

export function compareNeedsAttention(
  left: RankableAttentionItem,
  right: RankableAttentionItem,
): number {
  if (left.tier !== right.tier) {
    return left.tier - right.tier;
  }
  if (left.updatedAtMs !== right.updatedAtMs) {
    return right.updatedAtMs - left.updatedAtMs;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function rankNeedsAttentionItems(
  items: readonly HistoryItem[],
): HistoryItem[] {
  const ranked = items
    .flatMap((item) => {
      const tier =
        item.kind === "task"
          ? taskNeedsAttentionTier(item.status)
          : jobNeedsAttentionTier(item.status);
      if (tier === null) {
        return [];
      }
      return [
        {
          item,
          sort: {
            id: item.id,
            kind: item.kind,
            tier,
            updatedAtMs: new Date(item.updatedAt).getTime(),
          } satisfies RankableAttentionItem,
        },
      ];
    })
    .toSorted((left, right) => compareNeedsAttention(left.sort, right.sort))
    .slice(0, PROJECT_NEEDS_ATTENTION_LIMIT)
    .map(({ item }) => item);

  return ranked;
}

export interface GetProjectNeedsAttentionParams {
  workspaceId: string;
  projectId: string;
}

function mapTaskToHistoryItem(task: {
  id: string;
  name: string;
  description: string | null;
  status: TaskStatus;
  updatedAt: Date;
  projectId: string | null;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
}): HistoryItem {
  return {
    kind: "task",
    id: task.id,
    title: task.name,
    description: task.description,
    status: task.status,
    updatedAt: task.updatedAt.toISOString(),
    archivedAt: null,
    credits: null,
    projectId: task.projectId,
    coworkerId: task.assigneeId,
    sokoBotId: task.assigneeSokoBotId,
    owner: null,
  };
}

export function unsettledProjectJobsWhere(now: Date) {
  return {
    OR: [
      {
        jobType: JobType.FREE,
        events: { none: { status: AgentJobStatus.COMPLETED } },
      },
      {
        jobType: JobType.PAID,
        OR: [
          { externalDisputeUnlockTime: null },
          { externalDisputeUnlockTime: { gt: now } },
        ],
      },
    ],
  };
}

// ponytail: candidate window by Job.updatedAt. True top-5-by-tier needs a persisted status. Ceiling: 50 unsettled jobs per detail load.
export const PROJECT_NEEDS_ATTENTION_JOB_CANDIDATE_LIMIT = 50;

export function unsettledProjectJobsQuery(params: {
  projectId: string;
  workspaceId: string;
  now: Date;
}) {
  return {
    where: {
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      ...unsettledProjectJobsWhere(params.now),
    },
    orderBy: [{ updatedAt: "desc" as const }, { id: "desc" as const }],
    take: PROJECT_NEEDS_ATTENTION_JOB_CANDIDATE_LIMIT,
  };
}

export function jobAttentionUpdatedAt(job: {
  updatedAt: Date;
  purchase?: { updatedAt: Date } | null;
  events: readonly { createdAt: Date }[];
}): Date {
  let latest = job.updatedAt;
  const purchaseUpdatedAt = job.purchase?.updatedAt;
  if (purchaseUpdatedAt && purchaseUpdatedAt > latest) {
    latest = purchaseUpdatedAt;
  }
  const eventCreatedAt = job.events[0]?.createdAt;
  if (eventCreatedAt && eventCreatedAt > latest) {
    latest = eventCreatedAt;
  }
  return latest;
}

function mapJobToHistoryItem(job: {
  id: string;
  name: string | null;
  updatedAt: Date;
  projectId: string | null;
  agentId: string;
  status: SokosumiJobStatus;
  purchase?: { updatedAt: Date } | null;
  events: readonly { createdAt: Date }[];
}): HistoryItem {
  return {
    kind: "job",
    id: job.id,
    title: job.name?.trim() ? job.name : "Untitled job",
    description: null,
    status: job.status,
    updatedAt: jobAttentionUpdatedAt(job).toISOString(),
    archivedAt: null,
    credits: null,
    projectId: job.projectId,
    agentId: job.agentId,
    agentName: null,
    agentIcon: null,
    owner: null,
  };
}

export async function getProjectNeedsAttention(
  params: GetProjectNeedsAttentionParams,
): Promise<ProjectNeedsAttention | null> {
  const project = await prisma.project.findFirst({
    where: {
      id: params.projectId,
      workspaceId: params.workspaceId,
    },
    include: createProjectListCountsInclude(params.workspaceId),
  });

  if (!project) {
    return null;
  }

  const [attentionTasks, projectJobs] = await Promise.all([
    prisma.task.findMany({
      where: {
        projectId: params.projectId,
        workspaceId: params.workspaceId,
        archivedAt: null,
        status: { in: TASK_ATTENTION_STATUSES },
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        updatedAt: true,
        projectId: true,
        assigneeId: true,
        assigneeSokoBotId: true,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    }),
    prisma.job.findMany({
      ...unsettledProjectJobsQuery({
        projectId: params.projectId,
        workspaceId: params.workspaceId,
        now: new Date(),
      }),
      select: {
        id: true,
        name: true,
        updatedAt: true,
        agentId: true,
        ...jobForStatusComputeSelect,
        events: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          select: {
            status: true,
            createdAt: true,
            input: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const taskItems = attentionTasks.map(mapTaskToHistoryItem);
  const jobItems = projectJobs.flatMap((job) => {
    const status = computeJobStatus(job);
    if (jobNeedsAttentionTier(status) === null) {
      return [];
    }
    const completedAt =
      job.events.find((event) => event.status === AgentJobStatus.COMPLETED)
        ?.createdAt ?? null;
    if (isJobStatusSettled(job, completedAt)) {
      return [];
    }
    return [mapJobToHistoryItem({ ...job, status })];
  });

  const ranked = rankNeedsAttentionItems([...taskItems, ...jobItems]);
  const rankedAgentIds = [
    ...new Set(
      ranked.flatMap((item) =>
        item.kind === "job" && item.agentId ? [item.agentId] : [],
      ),
    ),
  ];
  const agentPreviewById = await loadAgentPreviewsByIds(rankedAgentIds, prisma);

  return projectNeedsAttentionSchema.parse({
    taskCount: project._count.tasks,
    jobCount: project._count.jobs,
    items: ranked.map((item) => {
      if (item.kind !== "job" || !item.agentId) {
        return item;
      }
      const preview = agentPreviewById.get(item.agentId);
      return {
        ...item,
        agentName: preview?.name ?? null,
        agentIcon: preview?.icon ?? null,
      };
    }),
  });
}
