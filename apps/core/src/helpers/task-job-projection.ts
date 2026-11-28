import type {
  Job,
  JobEvent,
  JobPurchase,
  SharedDb,
  Transaction,
} from "@sokosumi/database";
import type { JobWithListSummaryRelations } from "@sokosumi/database/types/job";

import { loadJobSharedRelations, readTaskJobs } from "@/helpers/job";
import { usesSharedMainnetJobs } from "@/helpers/job-projection";
import type { NetworkScope } from "@/lib/db/network-scope";
import { type taskInclude, taskListInclude } from "@/types/task";

export function taskJobProjectionInclude<
  I extends { jobs: typeof taskInclude.jobs },
>(
  include: I,
  scope: NetworkScope | null,
): Omit<I, "jobs"> & { jobs: I["jobs"] | false } {
  return { ...include, jobs: usesSharedMainnetJobs(scope) && include.jobs };
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

/** Prisma's shared-side transaction cannot include relations from another schema. */
async function readTaskJobsInTransaction(
  scope: NetworkScope,
  tx: SharedDb,
  taskId: string,
): Promise<JobWithListSummaryRelations[]> {
  const jobs = await tx.$queryRaw<Job[]>`
    SELECT * FROM ${scope.networkTable("Job")}
    WHERE "taskId" = ${taskId}
    ORDER BY "createdAt" ASC
  `;
  if (!jobs.length) return [];

  const ids = jobs.map(({ id }) => id);
  const events = await tx.$queryRaw<
    Array<
      Pick<JobEvent, "jobId" | "status" | "createdAt" | "result"> & {
        inputId: string | null;
      }
    >
  >`
    SELECT e."jobId", e.status, e."createdAt", e.result, i.id AS "inputId"
    FROM ${scope.networkTable("jobEvent")} e
    LEFT JOIN ${scope.networkTable("jobInput")} i ON i."eventId" = e.id
    WHERE e."jobId" = ANY(${ids}::text[])
    ORDER BY e."createdAt" DESC
  `;
  const purchases = await tx.$queryRaw<JobPurchase[]>`
    SELECT * FROM ${scope.networkTable("jobPurchase")}
    WHERE "jobId" = ANY(${ids}::text[])
  `;
  const transactionIds = jobs.flatMap(({ transactionId }) =>
    transactionId === null ? [] : [transactionId],
  );
  const transactions =
    transactionIds.length === 0
      ? []
      : await tx.$queryRaw<Transaction[]>`
    SELECT * FROM ${scope.networkTable("Transaction")}
    WHERE id = ANY(${transactionIds}::text[])
  `;

  type JobEventSummary = JobWithListSummaryRelations["events"][number];
  const eventsByJobId = new Map<string, JobEventSummary[]>();
  for (const { jobId, inputId, ...event } of events) {
    const summary = {
      ...event,
      input: inputId === null ? null : { id: inputId },
    };
    const list = eventsByJobId.get(jobId);
    if (list) list.push(summary);
    else eventsByJobId.set(jobId, [summary]);
  }
  const purchaseByJobId = new Map(
    purchases.map((purchase) => [purchase.jobId, purchase]),
  );
  const transactionById = new Map(
    transactions.map((transaction) => [transaction.id, transaction]),
  );
  return loadJobSharedRelations(
    tx,
    jobs.map((job) => ({
      ...job,
      events: eventsByJobId.get(job.id) ?? [],
      purchase: purchaseByJobId.get(job.id) ?? null,
      transaction:
        job.transactionId === null
          ? null
          : (transactionById.get(job.transactionId) ?? null),
    })),
  );
}

type WithJobs<T> = Omit<T, "jobs"> & { jobs: JobWithListSummaryRelations[] };

export async function withTaskResponseJobs<
  T extends { id: string; jobs?: Job[] },
>(task: T, scope: NetworkScope | null, tx?: SharedDb): Promise<WithJobs<T>> {
  // Prisma infers bare Job rows when a relation include can also be false.
  if (usesSharedMainnetJobs(scope)) {
    return { ...task, jobs: task.jobs as JobWithListSummaryRelations[] };
  }
  const jobs = !scope
    ? []
    : tx
      ? await readTaskJobsInTransaction(scope, tx, task.id)
      : await readTaskJobs(scope, task.id);
  return { ...task, jobs };
}

export async function readWorkspaceMoveTaskResponse<T extends { jobs?: Job[] }>(
  scope: NetworkScope | null,
  tx: SharedDb,
  taskId: string,
  read: () => Promise<T>,
): Promise<WithJobs<T>> {
  if (usesSharedMainnetJobs(scope)) {
    const task = await read();
    return { ...task, jobs: task.jobs as JobWithListSummaryRelations[] };
  }
  const jobs = scope ? await readTaskJobsInTransaction(scope, tx, taskId) : [];
  return { ...(await read()), jobs };
}
