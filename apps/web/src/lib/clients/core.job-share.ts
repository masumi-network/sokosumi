import type {
  Job as CoreJob,
  JobShare as CoreJobShare,
  TaskShare as CoreTaskShare,
  PublicSharedResourceResponse,
  PublicSharedTask,
} from "@/lib/clients/generated/core";

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapCoreJobShare(share: CoreJobShare): CoreJobShare {
  return {
    ...share,
    createdAt: toDate(share.createdAt),
    updatedAt: toDate(share.updatedAt),
  };
}

/**
 * Revives the date fields of a publicly shared job. The generated
 * `getShareByToken` transformer only revives `meta.timestamp` — the generator
 * skips the kind-discriminated union payload ("schema too complex"), so the
 * job dates arrive as ISO strings typed as `Date`. Mirrors the generated
 * `jobSchemaResponseTransformer` field list.
 */
function mapCorePublicSharedJob(job: CoreJob): CoreJob {
  return {
    ...job,
    createdAt: toDate(job.createdAt),
    updatedAt: toDate(job.updatedAt),
    completedAt: job.completedAt ? toDate(job.completedAt) : job.completedAt,
    payByTime: job.payByTime ? toDate(job.payByTime) : job.payByTime,
    submitResultTime: job.submitResultTime
      ? toDate(job.submitResultTime)
      : job.submitResultTime,
    unlockTime: job.unlockTime ? toDate(job.unlockTime) : job.unlockTime,
    externalDisputeUnlockTime: job.externalDisputeUnlockTime
      ? toDate(job.externalDisputeUnlockTime)
      : job.externalDisputeUnlockTime,
    events: job.events.map((event) => ({
      ...event,
      createdAt: toDate(event.createdAt),
      updatedAt: toDate(event.updatedAt),
      blobs: event.blobs.map((blob) => ({
        ...blob,
        createdAt: toDate(blob.createdAt),
        updatedAt: toDate(blob.updatedAt),
      })),
      links: event.links.map((link) => ({
        ...link,
        createdAt: toDate(link.createdAt),
        updatedAt: toDate(link.updatedAt),
      })),
    })),
  };
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
    const share = mapCoreJobShare(data.share);
    return {
      kind: "job",
      // The share fetched with the token is canonical for this view; pin it
      // onto the job payload so consumers see a consistent share state.
      job: { ...mapCorePublicSharedJob(data.job), share },
      share,
    };
  }

  return {
    kind: "task",
    task: mapCorePublicSharedTask(data.task),
    share: mapCoreTaskShare(data.share),
  };
}
