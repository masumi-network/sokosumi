import { HistoryKind, type Prisma, TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/database/types/job";
import { convertCentsToCredits } from "@sokosumi/utils";

import { createPaginationMeta } from "@/helpers/pagination";
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

export function buildHistoryWhere({
  projectId,
  q,
  scope,
  statuses,
  types,
  userContext,
  workspaceContext,
}: BuildHistoryWhereParams): Prisma.HistoryWhereInput {
  const workspaceKinds = types.filter(
    (kind) => kind === HistoryKind.TASK || kind === HistoryKind.JOB,
  );
  const shouldIncludeConversations =
    projectId === undefined && types.includes(HistoryKind.CONVERSATION);

  const visibilityBranches: Prisma.HistoryWhereInput[] = [
    ...(workspaceKinds.length > 0
      ? [
          {
            kind: { in: workspaceKinds },
            workspaceId: workspaceContext.workspaceId,
            ...(scope === "owned" ? { userId: userContext.userId } : {}),
            ...(projectId !== undefined ? { projectId } : {}),
          },
        ]
      : []),
    ...(shouldIncludeConversations
      ? [
          {
            kind: HistoryKind.CONVERSATION,
            userId: userContext.userId,
          },
        ]
      : []),
  ];

  if (visibilityBranches.length === 0) {
    return {
      AND: [{ archivedAt: null }, { id: { in: [] } }],
    };
  }

  return {
    AND: [
      { archivedAt: null },
      { OR: visibilityBranches },
      ...(statuses ? [{ status: { in: statuses } }] : []),
      ...(q
        ? [
            {
              OR: [
                { title: { contains: q, mode: "insensitive" as const } },
                { description: { contains: q, mode: "insensitive" as const } },
              ],
            },
          ]
        : []),
    ],
  };
}

export function mapHistoryRow(row: HistoryRowForApi): HistoryItem {
  const baseItem = {
    id: row.entityId,
    title: row.title,
    description: row.description,
    status: row.status,
    updatedAt: row.sortAt.toISOString(),
  };

  switch (row.kind) {
    case HistoryKind.TASK:
      return {
        ...baseItem,
        kind: "task",
        status: row.status as TaskStatus,
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
        status: row.status as SokosumiJobStatus,
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
