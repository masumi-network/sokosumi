import type {
  TaskShare as CoreTaskShare,
  PublicSharedResourceResponse,
  PublicSharedTask,
} from "@/lib/clients/generated/core";

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapCoreTaskShare(share: CoreTaskShare): CoreTaskShare {
  return {
    ...share,
    createdAt: toDate(share.createdAt),
    updatedAt: toDate(share.updatedAt),
  };
}

function mapCorePublicSharedTask(task: PublicSharedTask): PublicSharedTask {
  return {
    ...task,
    createdAt: toDate(task.createdAt),
    updatedAt: toDate(task.updatedAt),
    jobs: task.jobs.map((job) => ({
      ...job,
      createdAt: toDate(job.createdAt),
      completedAt: job.completedAt ? toDate(job.completedAt) : null,
    })),
    events: task.events.map((event) => ({
      ...event,
      createdAt: toDate(event.createdAt),
      updatedAt: toDate(event.updatedAt),
    })),
  };
}

export function mapCorePublicSharedResourceResponse(
  data: PublicSharedResourceResponse,
): PublicSharedResourceResponse {
  if (data.kind === "job") {
    return {
      kind: "job",
      // The share fetched with the token is canonical for this view; pin it
      // onto the job payload so consumers see a consistent share state.
      job: { ...data.job, share: data.share },
      share: data.share,
    };
  }

  return {
    kind: "task",
    task: mapCorePublicSharedTask(data.task),
    share: mapCoreTaskShare(data.share),
  };
}
