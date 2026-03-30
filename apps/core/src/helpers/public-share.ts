import { jobInclude, type Prisma } from "@sokosumi/database";
import {
  convertCentsToCredits,
  mapJobWithStatus,
} from "@sokosumi/database/helpers";
import {
  jobWithEvents,
  jobWithPurchase,
  jobWithShare,
  jobWithTransaction,
} from "@sokosumi/database/types/job";

import prisma from "@/lib/db/prisma";
import { serializeJobDetails } from "@/types/job";

interface PublicSharedTaskMilestone {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  origin: string;
  status: string;
  credits: number | null;
}

const publicTaskInclude = {
  coworker: {
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
      agent: true,
    },
    orderBy: { createdAt: "desc" },
  },
  events: {
    include: {
      transaction: {
        select: { amount: true },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  },
} as const satisfies Prisma.TaskInclude;

type PublicTaskWithRelations = Prisma.TaskGetPayload<{
  include: typeof publicTaskInclude;
}>;

function mapPublicTaskMilestone(
  event: PublicTaskWithRelations["events"][number],
): PublicSharedTaskMilestone | null {
  if (!event.status) {
    return null;
  }

  return {
    id: event.id,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    origin: event.origin,
    status: event.status,
    credits:
      event.transaction?.amount != null && event.transaction.amount < 0n
        ? convertCentsToCredits(event.transaction.amount * -1n)
        : null,
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
    agentName: taskJob.agent.overrideName ?? taskJob.agent.name,
    shareToken: taskJob.share?.token ?? null,
  };
}

function mapPublicTask(task: PublicTaskWithRelations) {
  return {
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    name: task.name,
    description: task.description,
    status: task.status,
    coworker: task.coworker
      ? {
          id: task.coworker.id,
          name: task.coworker.name,
          slug: task.coworker.slug,
          image: task.coworker.image,
        }
      : null,
    jobs: task.jobs.map((job) => mapPublicTaskJob(job)),
    events: task.events
      .map((event) => mapPublicTaskMilestone(event))
      .filter((event): event is PublicSharedTaskMilestone => event !== null),
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
    return {
      kind: "task" as const,
      share,
      task: mapPublicTask(share.task),
    };
  }

  throw new Error(`Public share ${share.id} is missing a target resource`);
}
