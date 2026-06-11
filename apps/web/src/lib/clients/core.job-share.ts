import type { JobShare, JobWithSokosumiStatus } from "@sokosumi/database";
import {
  mapCoreJobShare,
  mapCoreJobToJobWithSokosumiStatus,
} from "@/lib/agents/core-dto-mappers";
import type {
  PublicSharedJobResource as CorePublicSharedJobResource,
  TaskShare as CoreTaskShare,
  PublicSharedResourceResponse,
  PublicSharedTask,
} from "@/lib/clients/generated/core";

export interface PublicSharedJobResource {
  kind: "job";
  job: JobWithSokosumiStatus;
  share: JobShare;
}

export interface PublicSharedTaskResource {
  kind: "task";
  task: PublicSharedTask;
  share: CoreTaskShare;
}

export type PublicSharedResource =
  | PublicSharedJobResource
  | PublicSharedTaskResource;

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

export function mapCorePublicSharedJobResponse(
  data: CorePublicSharedJobResource,
): {
  job: JobWithSokosumiStatus;
  share: JobShare;
} {
  const share = mapCoreJobShare(data.share);
  const job = mapCoreJobToJobWithSokosumiStatus(data.job, { share });

  return { job, share };
}

export function mapCorePublicSharedResourceResponse(
  data: PublicSharedResourceResponse,
): PublicSharedResource {
  if (data.kind === "job") {
    const { job, share } = mapCorePublicSharedJobResponse(data);

    return {
      kind: "job",
      job,
      share,
    };
  }

  return {
    kind: "task",
    task: mapCorePublicSharedTask(data.task),
    share: mapCoreTaskShare(data.share),
  };
}
