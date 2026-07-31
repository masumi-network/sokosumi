import {
  type Agent,
  HistoryKind,
  type Prisma,
  TaskStatus,
} from "@sokosumi/database";
import { computeJobStatus } from "@sokosumi/database/helpers";
import { jobForStatusComputeSelect } from "@sokosumi/database/types/job";
import { convertCentsToCredits, SokosumiJobStatus } from "@sokosumi/utils";

import { getAgentIcon, getAgentName } from "@/helpers/agent";
import { createPaginationMeta } from "@/helpers/pagination";
import type prisma from "@/lib/db/prisma";
import type { UserContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import type { HistoryItem } from "@/schemas/history.schema";
import type { CursorPaginationMeta } from "@/schemas/pagination.schema";

export interface HistoryRowForApi {
  id: string;
  agentId: string | null;
  archivedAt: Date | null;
  bucketSlug: string | null;
  coworkerId: string | null;
  amount: bigint | null;
  description: string | null;
  entityId: string;
  kind: HistoryKind;
  projectId: string | null;
  sortAt: Date;
  status: string;
  title: string;
  userId: string;
}

export interface BuildHistoryWhereParams {
  projectId?: string | null;
  q?: string;
  scope: "owned" | "workspace";
  statuses?: string[];
  types: HistoryKind[];
  userContext: UserContext;
  workspaceContext: WorkspaceContext;
}

type HistoryPrismaClient = Pick<typeof prisma, "$queryRaw" | "job">;

const ARCHIVED_STATUS = "archived";
const ACTIVE_STATUS = "active";

const TASK_STATUS_FROM_JOB_STATUS: Partial<
  Record<SokosumiJobStatus, TaskStatus>
> = {
  [SokosumiJobStatus.COMPLETED]: TaskStatus.COMPLETED,
  [SokosumiJobStatus.FAILED]: TaskStatus.FAILED,
  [SokosumiJobStatus.INPUT_REQUIRED]: TaskStatus.INPUT_REQUIRED,
  [SokosumiJobStatus.PROCESSING]: TaskStatus.RUNNING,
};

const JOB_STATUS_FROM_TASK_STATUS: Partial<
  Record<TaskStatus, SokosumiJobStatus>
> = {
  [TaskStatus.COMPLETED]: SokosumiJobStatus.COMPLETED,
  [TaskStatus.FAILED]: SokosumiJobStatus.FAILED,
  [TaskStatus.INPUT_REQUIRED]: SokosumiJobStatus.INPUT_REQUIRED,
  [TaskStatus.RUNNING]: SokosumiJobStatus.PROCESSING,
};

function resolveTaskStatusesForFilter(statuses: string[]): TaskStatus[] {
  const resolved = new Set<TaskStatus>();

  for (const status of statuses) {
    if (Object.values(TaskStatus).includes(status as TaskStatus)) {
      resolved.add(status as TaskStatus);
      continue;
    }

    const uppercased = status.toUpperCase();
    if (Object.values(TaskStatus).includes(uppercased as TaskStatus)) {
      resolved.add(uppercased as TaskStatus);
      continue;
    }

    const jobStatus = Object.values(SokosumiJobStatus).find(
      (value) => value === status || value === status.toLowerCase(),
    );
    if (jobStatus) {
      const mapped = TASK_STATUS_FROM_JOB_STATUS[jobStatus];
      if (mapped) {
        resolved.add(mapped);
      }
    }
  }

  return [...resolved];
}

function resolveJobStatusesForFilter(statuses: string[]): string[] {
  const resolved = new Set<string>();

  for (const status of statuses) {
    const jobStatus = Object.values(SokosumiJobStatus).find(
      (value) => value === status || value === status.toLowerCase(),
    );
    if (jobStatus) {
      resolved.add(jobStatus);
      continue;
    }

    if (Object.values(TaskStatus).includes(status as TaskStatus)) {
      const mapped = JOB_STATUS_FROM_TASK_STATUS[status as TaskStatus];
      if (mapped) {
        resolved.add(mapped);
      }
      continue;
    }

    const uppercased = status.toUpperCase();
    if (Object.values(TaskStatus).includes(uppercased as TaskStatus)) {
      const mapped = JOB_STATUS_FROM_TASK_STATUS[uppercased as TaskStatus];
      if (mapped) {
        resolved.add(mapped);
      }
    }
  }

  return [...resolved];
}

export function buildHistoryArchivedFilter(
  statuses: string[] | undefined,
): Prisma.HistoryWhereInput | null {
  if (statuses?.includes(ARCHIVED_STATUS)) {
    return null;
  }

  return { archivedAt: null };
}

function appendKindBranches(
  branches: Prisma.HistoryWhereInput[],
  kindBranches: Prisma.HistoryWhereInput[],
) {
  if (kindBranches.length === 1) {
    branches.push(kindBranches[0]);
    return;
  }

  if (kindBranches.length > 1) {
    branches.push({ OR: kindBranches });
  }
}

export function buildHistoryStatusFilter(
  statuses: string[],
  types: HistoryKind[],
  jobEntityIds: string[] | undefined,
): Prisma.HistoryWhereInput {
  const includesArchived = statuses.includes(ARCHIVED_STATUS);
  const includesActive = statuses.includes(ACTIVE_STATUS);
  const kindStatuses = statuses.filter(
    (status) => status !== ARCHIVED_STATUS && status !== ACTIVE_STATUS,
  );
  const taskStatuses = resolveTaskStatusesForFilter(kindStatuses);
  const branches: Prisma.HistoryWhereInput[] = [];

  if (types.includes(HistoryKind.TASK)) {
    const taskBranches: Prisma.HistoryWhereInput[] = [];

    if (taskStatuses.length > 0) {
      taskBranches.push({
        kind: HistoryKind.TASK,
        status: { in: taskStatuses },
        archivedAt: null,
      });
    } else if (includesActive && includesArchived) {
      taskBranches.push({
        kind: HistoryKind.TASK,
        archivedAt: null,
      });
    }

    if (includesArchived) {
      taskBranches.push({
        kind: HistoryKind.TASK,
        archivedAt: { not: null },
      });
    }

    appendKindBranches(branches, taskBranches);
  }

  if (types.includes(HistoryKind.JOB)) {
    const jobBranches: Prisma.HistoryWhereInput[] = [];

    if (jobEntityIds !== undefined) {
      jobBranches.push({
        kind: HistoryKind.JOB,
        entityId: { in: jobEntityIds },
      });
    }

    appendKindBranches(branches, jobBranches);
  }

  if (branches.length === 0) {
    return { id: { in: [] } };
  }

  return { OR: branches };
}

export async function findJobHistoryEntityIdsMatchingStatuses(
  {
    projectId,
    scope,
    statuses,
    userContext,
    workspaceContext,
  }: BuildHistoryWhereParams,
  prismaClient: HistoryPrismaClient,
): Promise<string[]> {
  const owned = scope === "owned";
  const hasProjectFilter = projectId !== undefined;

  const rows = await prismaClient.$queryRaw<Array<{ entityId: string }>>`
    SELECT h."entityId"
    FROM "history" h
    WHERE h."archivedAt" IS NULL
      AND h."kind" = 'JOB'::"HistoryKind"
      AND h."workspaceId" = ${workspaceContext.workspaceId}::uuid
      AND (${owned} = false OR h."userId" = ${userContext.userId})
      AND (
        ${hasProjectFilter} = false
        OR h."projectId" IS NOT DISTINCT FROM ${projectId ?? null}
      )
      AND compute_history_job_status(h."entityId") = ANY(${statuses}::text[])
  `;

  return rows.map((row) => row.entityId);
}

export async function buildHistoryWhere(
  params: BuildHistoryWhereParams,
  prismaClient: HistoryPrismaClient,
): Promise<Prisma.HistoryWhereInput> {
  const workspaceKinds = params.types.filter(
    (kind) => kind === HistoryKind.TASK || kind === HistoryKind.JOB,
  );

  const visibilityBranches: Prisma.HistoryWhereInput[] = [
    ...(workspaceKinds.length > 0
      ? [
          {
            kind: { in: workspaceKinds },
            workspaceId: params.workspaceContext.workspaceId,
            ...(params.scope === "owned"
              ? { userId: params.userContext.userId }
              : {}),
            ...(params.projectId !== undefined
              ? { projectId: params.projectId }
              : {}),
          },
        ]
      : []),
  ];

  if (visibilityBranches.length === 0) {
    const andClauses: Prisma.HistoryWhereInput[] = [{ id: { in: [] } }];
    const archivedFilter = buildHistoryArchivedFilter(params.statuses);
    if (archivedFilter) {
      andClauses.unshift(archivedFilter);
    }
    return { AND: andClauses };
  }

  const andClauses: Prisma.HistoryWhereInput[] = [{ OR: visibilityBranches }];
  const archivedFilter = buildHistoryArchivedFilter(params.statuses);
  if (archivedFilter) {
    andClauses.unshift(archivedFilter);
  }

  if (params.statuses?.length) {
    const kindStatuses = params.statuses.filter(
      (status) => status !== ARCHIVED_STATUS && status !== ACTIVE_STATUS,
    );
    const jobStatuses = resolveJobStatusesForFilter(kindStatuses);
    const jobEntityIds =
      params.types.includes(HistoryKind.JOB) && jobStatuses.length > 0
        ? await findJobHistoryEntityIdsMatchingStatuses(
            { ...params, statuses: jobStatuses },
            prismaClient,
          )
        : undefined;

    andClauses.push(
      buildHistoryStatusFilter(params.statuses, params.types, jobEntityIds),
    );
  }

  if (params.q) {
    andClauses.push({
      OR: [
        { title: { contains: params.q, mode: "insensitive" } },
        { description: { contains: params.q, mode: "insensitive" } },
      ],
    });
  }

  return { AND: andClauses };
}

export async function loadComputedJobStatusByEntityId(
  entityIds: string[],
  prismaClient: HistoryPrismaClient,
): Promise<Map<string, SokosumiJobStatus>> {
  if (entityIds.length === 0) {
    return new Map();
  }

  const jobs = await prismaClient.job.findMany({
    where: { id: { in: entityIds } },
    select: {
      id: true,
      ...jobForStatusComputeSelect,
    },
  });

  return new Map(jobs.map((job) => [job.id, computeJobStatus(job)]));
}

export interface AgentPreview {
  name: string;
  icon: string | null;
}

export interface UserPreview {
  userId: string;
  name: string;
  image: string | null;
}

/**
 * Resolves an agent icon to a renderable URL. Reuses the shared getAgentIcon
 * resolution and additionally drops values that are not valid URLs, mirroring
 * the web client's previous history rendering (which fell back to no icon for
 * unparseable values).
 */
function resolveAgentIcon(agent: Pick<Agent, "icon">): string | null {
  const resolvedUrl = getAgentIcon(agent);
  if (!resolvedUrl) {
    return null;
  }
  try {
    new URL(resolvedUrl);
    return resolvedUrl;
  } catch {
    return null;
  }
}

/**
 * Batch-loads display name and resolved icon for the given agent ids. Used to
 * enrich job history rows so the web client no longer needs direct DB access.
 * Failures degrade to an empty map so callers can render null fields instead
 * of failing the request.
 */
export async function loadAgentPreviewsByIds(
  agentIds: string[],
  prismaClient: Pick<typeof prisma, "agent">,
): Promise<Map<string, AgentPreview>> {
  if (agentIds.length === 0) {
    return new Map();
  }

  const agents = await prismaClient.agent
    .findMany({
      where: { id: { in: agentIds } },
      select: {
        id: true,
        name: true,
        icon: true,
        metadataOverride: { select: { name: true } },
      },
    })
    .catch((error) => {
      // Best-effort enrichment: degrade to null name/icon rather than failing
      // the history request, but log so a real DB failure stays observable.
      console.warn("Failed to load agent previews for history feed", {
        agentIdCount: agentIds.length,
        error,
      });
      return [];
    });

  return new Map(
    agents.map((agent) => [
      agent.id,
      {
        name: getAgentName(agent),
        icon: resolveAgentIcon(agent),
      },
    ]),
  );
}

/**
 * Batch-loads display name and image for the given user ids. Used to enrich
 * history rows with owner information so the web client can display owner
 * avatars in org contexts. Failures degrade to an empty map so callers can
 * render null owner fields instead of failing the request.
 */
export async function loadUserPreviewsByIds(
  userIds: string[],
  prismaClient: Pick<typeof prisma, "user">,
): Promise<Map<string, UserPreview>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const users = await prismaClient.user
    .findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, image: true },
    })
    .catch((error) => {
      // Best-effort enrichment: degrade to null owner rather than failing
      // the history request, but log so a real DB failure stays observable.
      console.warn("Failed to load user previews for history feed", {
        userIdCount: userIds.length,
        error,
      });
      return [];
    });

  return new Map(
    users.map((user) => [
      user.id,
      {
        userId: user.id,
        name: user.name ?? "Unknown User",
        image: user.image,
      },
    ]),
  );
}

export function mapHistoryRow(
  row: HistoryRowForApi,
  options?: {
    jobStatusByEntityId?: Map<string, SokosumiJobStatus>;
    agentPreviewById?: Map<string, AgentPreview>;
    userPreviewById?: Map<string, UserPreview>;
  },
): HistoryItem {
  const jobStatus =
    row.kind === HistoryKind.JOB
      ? options?.jobStatusByEntityId?.get(row.entityId)
      : undefined;
  const status = jobStatus ?? row.status;

  const userPreview = options?.userPreviewById?.get(row.userId);
  const owner = userPreview
    ? {
        userId: userPreview.userId,
        name: userPreview.name,
        image: userPreview.image,
      }
    : null;

  const baseItem = {
    id: row.entityId,
    title: row.title,
    description: row.description,
    status,
    updatedAt: row.sortAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    owner,
  };

  switch (row.kind) {
    case HistoryKind.TASK:
      return {
        ...baseItem,
        kind: "task",
        status: status as TaskStatus,
        credits: row.amount != null ? convertCentsToCredits(row.amount) : null,
        projectId: row.projectId,
        coworkerId: row.coworkerId,
      };
    case HistoryKind.JOB: {
      const agentId = row.agentId ?? "";
      const agentPreview = row.agentId
        ? options?.agentPreviewById?.get(row.agentId)
        : undefined;
      return {
        ...baseItem,
        kind: "job",
        status: status as SokosumiJobStatus,
        credits: row.amount != null ? convertCentsToCredits(row.amount) : null,
        projectId: row.projectId,
        agentId,
        agentName: agentPreview?.name ?? null,
        agentIcon: agentPreview?.icon ?? null,
      };
    }
  }
}

export function createHistoryPaginationMeta(
  items: HistoryItem[],
  count: number,
  take: number,
  hasMore: boolean,
  cursor: string | undefined,
): CursorPaginationMeta {
  return createPaginationMeta(items, count, take, hasMore, cursor);
}
