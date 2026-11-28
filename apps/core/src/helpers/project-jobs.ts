import type { AgentJobStatus, Job, JobPurchase } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";

import type { NetworkScope } from "@/lib/db/network-scope";
import type { ProjectReaderSqlVisibility } from "@/types/project";

export function projectJobParentJoin(
  visibility: ProjectReaderSqlVisibility["scopedJob"],
) {
  return PrismaRaw.sql`
    LEFT JOIN ${sharedTable("task")} t ON t.id = j."taskId"
    ${visibility.join}
  `;
}

export async function countProjectJobs(
  scope: NetworkScope,
  workspaceId: string,
  projectIds: string[],
  visibility: ProjectReaderSqlVisibility["scopedJob"],
) {
  if (!projectIds.length) return new Map<string, number>();
  const rows = await scope.sharedDb.$queryRaw<
    { projectId: string; count: bigint }[]
  >`
    SELECT j."projectId", count(*) AS count
    FROM ${scope.networkTable("Job")} j
    ${projectJobParentJoin(visibility)}
    WHERE j."workspaceId" = ${workspaceId}::uuid
      AND j."projectId" = ANY(${projectIds}::uuid[])
      ${visibility.predicate}
    GROUP BY j."projectId"
  `;
  return new Map(
    rows.map(({ projectId, count }) => [projectId, Number(count)]),
  );
}

type ProjectJobRow = Pick<
  Job,
  | "id"
  | "name"
  | "agentId"
  | "projectId"
  | "jobType"
  | "refundedTransactionId"
  | "createdAt"
  | "updatedAt"
  | "payByTime"
  | "submitResultTime"
  | "externalDisputeUnlockTime"
> & {
  purchase: Omit<JobPurchase, "createdAt" | "updatedAt"> | null;
  purchaseCreatedAt: Date | null;
  purchaseUpdatedAt: Date | null;
  eventStatus: AgentJobStatus | null;
  eventCreatedAt: Date | null;
  inputId: string | null;
};

export async function readProjectJobPage(
  scope: NetworkScope,
  params: {
    workspaceId: string;
    projectIds: readonly string[];
    visibility: ProjectReaderSqlVisibility["scopedJob"];
    take: number;
    afterId?: string;
    unsettledAt?: Date;
  },
) {
  const { workspaceId, projectIds, visibility, take, afterId, unsettledAt } =
    params;
  const { sql, empty } = PrismaRaw;
  const orderBy =
    unsettledAt !== undefined ? sql`j."updatedAt" DESC, j.id DESC` : sql`j.id`;
  const rows = await scope.sharedDb.$queryRaw<ProjectJobRow[]>`
    WITH page AS MATERIALIZED (
      SELECT j.id, j.name, j."agentId", j."projectId", j."jobType", j."refundedTransactionId",
        j."createdAt", j."updatedAt", j."payByTime", j."submitResultTime", j."externalDisputeUnlockTime"
      FROM ${scope.networkTable("Job")} j
      ${projectJobParentJoin(visibility)}
      ${
        unsettledAt !== undefined
          ? sql`LEFT JOIN LATERAL (
        SELECT e."jobId"
        FROM ${scope.networkTable("jobEvent")} e
        WHERE j."jobType" = 'FREE' AND e."jobId" = j.id AND e.status = 'COMPLETED'
        LIMIT 1
      ) done ON TRUE`
          : empty
      }
      WHERE j."workspaceId" = ${workspaceId}::uuid
        AND j."projectId" = ANY(${[...projectIds]}::uuid[])
        ${visibility.predicate}
        ${afterId !== undefined ? sql`AND j.id > ${afterId}` : empty}
        ${
          unsettledAt !== undefined
            ? sql`AND (
          (j."jobType" = 'FREE' AND done."jobId" IS NULL)
          OR (j."jobType" = 'PAID' AND
            (j."externalDisputeUnlockTime" IS NULL OR j."externalDisputeUnlockTime" > ${unsettledAt}))
        )`
            : empty
        }
      ORDER BY ${orderBy}
      LIMIT ${take}
    )
    SELECT j.id, j.name, j."agentId", j."projectId", j."jobType"::text, j."refundedTransactionId",
      j."createdAt", j."updatedAt", j."payByTime", j."submitResultTime", j."externalDisputeUnlockTime",
      to_jsonb(p) - 'createdAt' - 'updatedAt' AS purchase,
      p."createdAt" AS "purchaseCreatedAt", p."updatedAt" AS "purchaseUpdatedAt",
      e.status::text AS "eventStatus", e."createdAt" AS "eventCreatedAt", e."inputId"
    FROM page j
    LEFT JOIN LATERAL (
      SELECT p.* FROM ${scope.networkTable("jobPurchase")} p
      WHERE p."jobId" = j.id
      LIMIT 1
    ) p ON TRUE
    LEFT JOIN LATERAL (
      SELECT e.status, e."createdAt", i.id AS "inputId"
      FROM ${scope.networkTable("jobEvent")} e
      LEFT JOIN ${scope.networkTable("jobInput")} i ON i."eventId" = e.id
      WHERE e."jobId" = j.id
      ORDER BY e."createdAt" DESC
      LIMIT 1
    ) e ON TRUE
    ORDER BY ${orderBy}
  `;
  return rows.map(
    ({
      purchase,
      purchaseCreatedAt,
      purchaseUpdatedAt,
      eventStatus,
      eventCreatedAt,
      inputId,
      ...job
    }) => ({
      ...job,
      purchase:
        purchase && purchaseCreatedAt && purchaseUpdatedAt
          ? {
              ...purchase,
              createdAt: purchaseCreatedAt,
              updatedAt: purchaseUpdatedAt,
            }
          : null,
      events:
        eventStatus !== null && eventCreatedAt !== null
          ? [
              {
                status: eventStatus,
                createdAt: eventCreatedAt,
                input: inputId === null ? null : { id: inputId },
              },
            ]
          : [],
    }),
  );
}
