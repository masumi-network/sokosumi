import { jobInclude, type Prisma } from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import {
  jobWithEvents,
  jobWithPurchase,
  jobWithShare,
  jobWithTransaction,
} from "@sokosumi/database/types/job";
import { convertCentsToCredits } from "@sokosumi/utils";

import { getAgentName } from "@/helpers/agent";
import prisma from "@/lib/db/prisma";
import { serializeJobDetails } from "@/types/job";

interface PublicSharedTaskMilestone {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  channel: string;
  origin: string;
  status: string | null;
  comment: string | null;
  credits: number | null;
  transactionId: string | null;
  actorName: string | null;
  actorImage: string | null;
}

const publicTaskInclude = {
  assignee: {
    select: {
      id: true,
      name: true,
      slug: true,
      image: true,
    },
  },
  jobs: {
    include: {
      ...jobWithEvents,
      ...jobWithPurchase,
      ...jobWithTransaction,
      ...jobWithShare,
      agent: {
        include: {
          metadataOverride: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
  files: {
    select: {
      id: true,
      name: true,
      fileUrl: true,
      mimeType: true,
      size: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  },
  events: {
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      channel: true,
      status: true,
      comment: true,
      cents: true,
      transactionId: true,
      user: {
        select: {
          name: true,
          image: true,
        },
      },
      coworker: {
        select: {
          name: true,
          image: true,
        },
      },
      sokoBot: {
        select: {
          name: true,
        },
      },
      transaction: {
        select: { amount: true },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  },
} as const satisfies Prisma.TaskInclude;

type PublicTaskWithRelations = Prisma.TaskGetPayload<{
  include: typeof publicTaskInclude;
}>;

function mapPublicTaskMilestone(
  event: PublicTaskWithRelations["events"][number],
): PublicSharedTaskMilestone | null {
  const comment = event.comment?.trim() || null;
  // Prefer event.cents (auth mapTaskEvent). Fall back to spend amount for
  // historical settled rows that stored a transaction but null cents.
  const creditsFromCents =
    event.cents != null ? convertCentsToCredits(event.cents) : null;
  const creditsFromSpend =
    event.transaction?.amount != null && event.transaction.amount < 0n
      ? convertCentsToCredits(event.transaction.amount * -1n)
      : null;
  const credits = creditsFromCents ?? creditsFromSpend;

  if (!event.status && !comment && credits == null) {
    return null;
  }

  return {
    id: event.id,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    channel: event.channel,
    origin: event.channel,
    status: event.status,
    comment,
    credits,
    transactionId: event.transactionId ?? null,
    // Prefer order matches Core task events: sokoBot → coworker → user.
    actorName:
      event.sokoBot?.name ?? event.coworker?.name ?? event.user?.name ?? null,
    actorImage: event.coworker?.image ?? event.user?.image ?? null,
  };
}

function mapPublicTaskJob(taskJob: PublicTaskWithRelations["jobs"][number]) {
  const job = mapJobWithStatus(taskJob);

  return {
    id: taskJob.id,
    createdAt: taskJob.createdAt,
    completedAt: job.completedAt,
    name: taskJob.name,
    status: job.status,
    agentName: getAgentName(taskJob.agent),
    shareToken: taskJob.share?.token ?? null,
  };
}

function mapPublicTask(task: PublicTaskWithRelations) {
  const assignee = task.assignee
    ? {
        id: task.assignee.id,
        name: task.assignee.name,
        slug: task.assignee.slug,
        image: task.assignee.image,
      }
    : null;

  return {
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    name: task.name,
    description: task.description,
    status: task.status,
    assignee,
    /** @deprecated Use `assignee`. */
    coworker: assignee,
    jobs: task.jobs.map((job) => mapPublicTaskJob(job)),
    events: task.events
      .map((event) => mapPublicTaskMilestone(event))
      .filter((event): event is PublicSharedTaskMilestone => event !== null),
    files: (task.files ?? [])
      .filter(
        (file): file is typeof file & { fileUrl: string } =>
          file.fileUrl !== null,
      )
      .map((file) => ({
        id: file.id,
        name: file.name,
        fileUrl: file.fileUrl,
        mimeType: file.mimeType ?? null,
        size: file.size != null ? Number(file.size) : null,
        createdAt: file.createdAt,
      })),
  };
}

export async function getPublicSharedResourceByToken(token: string) {
  const share = await prisma.publicShare.findUnique({
    where: { token },
    include: {
      job: {
        include: jobInclude,
      },
      task: {
        include: publicTaskInclude,
      },
    },
  });

  if (!share) {
    return null;
  }

  if (share.job) {
    return {
      kind: "job" as const,
      share,
      job: serializeJobDetails(mapJobWithStatus(share.job)),
    };
  }

  if (share.task) {
    if (share.task.archivedAt) {
      return null;
    }

    return {
      kind: "task" as const,
      share,
      task: mapPublicTask(share.task),
    };
  }

  throw new Error(`Public share ${share.id} is missing a target resource`);
}
