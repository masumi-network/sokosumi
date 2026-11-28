import type {
  Job,
  JobPurchase,
  SharedDb,
  Task,
  Transaction,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";
import type { JobWithListSummaryRelations } from "@sokosumi/database/types/job";

import { loadJobSharedRelations } from "@/helpers/job";
import { usesSharedMainnetJobs } from "@/helpers/job-projection";
import type { NetworkScope } from "@/lib/db/network-scope";
import { type taskInclude, taskListInclude } from "@/types/task";

export function taskJobProjectionInclude<
  I extends { jobs: typeof taskInclude.jobs },
>(
  include: I,
  scope: NetworkScope | null,
): Omit<I, "jobs"> & { jobs: I["jobs"] | false } {
  if (usesSharedMainnetJobs(scope)) return include;
  return { ...include, jobs: false };
}

export function taskListJobProjectionInclude(scope: NetworkScope | null) {
  return {
    ...taskListInclude,
    _count: {
      select: {
        ...taskListInclude._count.select,
        jobs: usesSharedMainnetJobs(scope),
      },
    },
  } as const;
}

export async function countTaskJobs(scope: NetworkScope, taskIds: string[]) {
  if (!taskIds.length) return new Map<string, number>();
  const counts = await scope.networkDb.$queryRaw<
    { taskId: string; count: bigint }[]
  >`
    SELECT "taskId", COUNT(*) AS count
    FROM ${scope.networkTable("Job")}
    WHERE "taskId" = ANY(${taskIds}::text[])
    GROUP BY "taskId"
  `;
  return new Map(counts.map(({ taskId, count }) => [taskId, Number(count)]));
}

type TaskPlacement = Pick<Task, "workspaceId" | "projectId" | "archivedAt">;
type JsonTimestamps = { createdAt: string; updatedAt: string };
type TaskJobRow = Job & {
  events: (Omit<JobWithListSummaryRelations["events"][number], "createdAt"> & {
    createdAt: string;
  })[];
  purchase: (Omit<JobPurchase, keyof JsonTimestamps> & JsonTimestamps) | null;
  transaction:
    | (Omit<Transaction, keyof JsonTimestamps | "amount"> &
        JsonTimestamps & { amount: string })
    | null;
};

function parseTimestamps<T extends JsonTimestamps>(row: T) {
  return {
    ...row,
    createdAt: new Date(`${row.createdAt}Z`),
    updatedAt: new Date(`${row.updatedAt}Z`),
  };
}

/**
 * Prisma's shared-side transaction cannot include relations from another schema.
 * Read Job state and its parent at the same PostgreSQL snapshot.
 */
async function readSplitTaskJobs(
  scope: NetworkScope,
  taskId: string,
  placement: TaskPlacement | null,
  tx?: SharedDb,
): Promise<JobWithListSummaryRelations[]> {
  const db = tx ?? scope.sharedDb;
  const jobs = await db.$queryRaw<TaskJobRow[]>`
    SELECT j.*, e.events, to_jsonb(p) AS purchase,
      CASE WHEN d.id IS NOT NULL
        THEN to_jsonb(d) || jsonb_build_object('amount', d.amount::text)
      END AS transaction
    FROM ${scope.networkTable("Job")} j
    JOIN ${sharedTable("task")} t ON t.id = j."taskId"
    LEFT JOIN LATERAL (
      SELECT p.* FROM ${scope.networkTable("jobPurchase")} p
      WHERE p."jobId" = j.id
      LIMIT 1
    ) p ON TRUE
    LEFT JOIN ${scope.networkTable("Transaction")} d ON d.id = j."transactionId"
    CROSS JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'status', e.status, 'createdAt', e."createdAt", 'result', e.result,
        'input', CASE WHEN i.id IS NOT NULL THEN jsonb_build_object('id', i.id) END
      ) ORDER BY e."createdAt" DESC), '[]'::jsonb) AS events
      FROM ${scope.networkTable("jobEvent")} e
      LEFT JOIN ${scope.networkTable("jobInput")} i ON i."eventId" = e.id
      WHERE e."jobId" = j.id
    ) e
    WHERE j."taskId" = ${taskId}
      ${
        placement
          ? PrismaRaw.sql`AND t."workspaceId" = ${placement.workspaceId}::uuid
          AND t."projectId" IS NOT DISTINCT FROM ${placement.projectId}::uuid
          AND t."archivedAt" IS NOT DISTINCT FROM ${placement.archivedAt}::timestamp`
          : PrismaRaw.empty
      }
    ORDER BY j."createdAt" ASC
  `;

  return loadJobSharedRelations(
    db,
    jobs.map(({ events, purchase, transaction, ...job }) => ({
      ...job,
      events: events.map((event) => ({
        ...event,
        createdAt: new Date(`${event.createdAt}Z`),
      })),
      purchase: purchase ? parseTimestamps(purchase) : null,
      transaction: transaction
        ? {
            ...parseTimestamps(transaction),
            amount: BigInt(transaction.amount),
          }
        : null,
    })),
    tx !== undefined,
  );
}

type JobProjection = { jobs: JobWithListSummaryRelations[] };
type WithJobs<T> = Omit<T, "jobs"> & JobProjection;

export async function withTaskResponseJobs<
  T extends TaskPlacement & { id: string; jobs?: Job[] },
>(task: T, scope: NetworkScope | null, tx?: SharedDb): Promise<WithJobs<T>> {
  // Prisma infers bare Job rows when a relation include can also be false.
  if (usesSharedMainnetJobs(scope)) {
    return task as T & JobProjection;
  }
  const jobs = scope ? await readSplitTaskJobs(scope, task.id, task, tx) : [];
  return { ...task, jobs };
}

export async function readWorkspaceMoveTaskResponse<
  T extends { id: string; jobs?: Job[] },
>(
  scope: NetworkScope | null,
  tx: SharedDb,
  taskId: string,
  read: () => Promise<T>,
): Promise<WithJobs<T>> {
  if (usesSharedMainnetJobs(scope)) {
    return read() as Promise<T & JobProjection>;
  }
  const jobs = scope ? await readSplitTaskJobs(scope, taskId, null, tx) : [];
  return { ...(await read()), jobs };
}
