import { HistoryKind, type Prisma, TaskStatus } from "@sokosumi/database";
import { computeJobStatus } from "@sokosumi/database/helpers";
import {
  jobForStatusComputeSelect,
  SokosumiJobStatus,
} from "@sokosumi/database/types/job";
import { convertCentsToCredits } from "@sokosumi/utils";

import { createPaginationMeta } from "@/helpers/pagination";
import type prisma from "@/lib/db/prisma";
import type { UserContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import type { HistoryItem } from "@/schemas/history.schema";
import type { CursorPaginationMeta } from "@/schemas/pagination.schema";

export interface HistoryRowForApi {
  id: string;
  agentId: string | null;
  bucketSlug: string | null;
  coworkerId: string | null;
  creditsCents: bigint | null;
  description: string | null;
  entityId: string;
  kind: HistoryKind;
  projectId: string | null;
  sortAt: Date;
  status: string;
  title: string;
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

export function buildHistoryStatusFilter(
  statuses: string[],
  types: HistoryKind[],
  jobEntityIds: string[],
): Prisma.HistoryWhereInput {
  const branches: Prisma.HistoryWhereInput[] = [];

  if (types.includes(HistoryKind.TASK)) {
    branches.push({
      kind: HistoryKind.TASK,
      status: { in: statuses },
    });
  }

  if (types.includes(HistoryKind.CONVERSATION)) {
    branches.push({
      kind: HistoryKind.CONVERSATION,
      status: { in: statuses },
    });
  }

  if (types.includes(HistoryKind.JOB)) {
    branches.push({
      kind: HistoryKind.JOB,
      entityId: { in: jobEntityIds },
    });
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
  const shouldIncludeConversations = params.types.includes(
    HistoryKind.CONVERSATION,
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
    ...(shouldIncludeConversations
      ? [
          {
            kind: HistoryKind.CONVERSATION,
            userId: params.userContext.userId,
          },
        ]
      : []),
  ];

  if (visibilityBranches.length === 0) {
    return {
      AND: [{ archivedAt: null }, { id: { in: [] } }],
    };
  }

  const andClauses: Prisma.HistoryWhereInput[] = [
    { archivedAt: null },
    { OR: visibilityBranches },
  ];

  if (params.statuses?.length) {
    const jobEntityIds = params.types.includes(HistoryKind.JOB)
      ? await findJobHistoryEntityIdsMatchingStatuses(params, prismaClient)
      : [];

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

export function mapHistoryRow(
  row: HistoryRowForApi,
  options?: {
    jobStatusByEntityId?: Map<string, SokosumiJobStatus>;
  },
): HistoryItem {
  const jobStatus =
    row.kind === HistoryKind.JOB
      ? options?.jobStatusByEntityId?.get(row.entityId)
      : undefined;
  const status = jobStatus ?? row.status;

  const baseItem = {
    id: row.entityId,
    title: row.title,
    description: row.description,
    status,
    updatedAt: row.sortAt.toISOString(),
  };

  switch (row.kind) {
    case HistoryKind.TASK:
      return {
        ...baseItem,
        kind: "task",
        status: status as TaskStatus,
        credits:
          row.creditsCents != null
            ? convertCentsToCredits(row.creditsCents)
            : null,
        projectId: row.projectId,
        coworkerId: row.coworkerId,
      };
    case HistoryKind.JOB:
      return {
        ...baseItem,
        kind: "job",
        status: status as SokosumiJobStatus,
        credits:
          row.creditsCents != null
            ? convertCentsToCredits(row.creditsCents)
            : null,
        projectId: row.projectId,
        agentId: row.agentId ?? "",
      };
    case HistoryKind.CONVERSATION:
      return {
        ...baseItem,
        kind: "conversation",
        status: row.status === "archived" ? "archived" : "active",
        credits: null,
        bucketSlug: row.bucketSlug,
      };
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
