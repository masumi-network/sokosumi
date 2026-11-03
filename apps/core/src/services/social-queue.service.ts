import type { Prisma } from "@sokosumi/database";
import { SOCIAL_POST_MIN_SCHEDULE_LEAD_MS } from "@sokosumi/utils";

import { badRequest, conflict, notFound } from "@/helpers/error";
import { nextSocialQueueSlotAt } from "@/helpers/social-queue-slot";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  getSocialPost,
  type SocialPostSummary,
  scheduleSocialPost,
} from "@/services/social-posts.service";

const QUEUE_OCCUPIED_STATUSES = [
  "SCHEDULED",
  "NEEDS_APPROVAL",
  "PUBLISHING",
] as const;
const QUEUE_LOOKAHEAD_MS = 12 * 7 * 24 * 60 * 60 * 1000;

export interface SocialQueueSlotSummary {
  id: string;
  name: string;
  weekday: number;
  minutesFromMidnight: number;
  timezone: string;
}

export interface SocialQueueSlotsSummary {
  timezone: string | null;
  slots: SocialQueueSlotSummary[];
}

interface ProjectScope {
  projectId: string;
  workspaceId: string;
}

export interface ReplaceSocialQueueSlotsInput extends ProjectScope {
  timezone: string;
  slots: Array<{
    name: string;
    weekday: number;
    minutesFromMidnight: number;
  }>;
}

export interface ResolveNextSocialQueueSlotInput extends ProjectScope {
  socialConnectionId: string;
}

export interface QueueSocialPostInput extends ProjectScope {
  userId: string;
  coworkerId?: string;
  postId: string;
  socialConnectionId?: string;
  revision: number;
}

function mapSlot(slot: {
  id: string;
  name: string;
  weekday: number;
  minutesFromMidnight: number;
  timezone: string;
}): SocialQueueSlotSummary {
  return {
    id: slot.id,
    name: slot.name,
    weekday: slot.weekday,
    minutesFromMidnight: slot.minutesFromMidnight,
    timezone: slot.timezone,
  };
}

async function requireScopedProject(
  input: ProjectScope,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const project = await tx.project.findFirst({
    where: { id: input.projectId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!project) {
    throw notFound("Project not found");
  }
}

export async function listSocialQueueSlots(
  input: ProjectScope,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialQueueSlotsSummary> {
  await requireScopedProject(input, tx);
  const slots = await tx.projectSocialQueueSlot.findMany({
    where: { projectId: input.projectId },
    orderBy: [{ weekday: "asc" }, { minutesFromMidnight: "asc" }],
  });
  return {
    timezone: slots[0]?.timezone ?? null,
    slots: slots.map(mapSlot),
  };
}

export async function replaceSocialQueueSlots(
  input: ReplaceSocialQueueSlotsInput,
): Promise<SocialQueueSlotsSummary> {
  return serializableTransaction(async (tx) => {
    await requireScopedProject(input, tx);
    await tx.projectSocialQueueSlot.deleteMany({
      where: { projectId: input.projectId },
    });
    if (input.slots.length > 0) {
      await tx.projectSocialQueueSlot.createMany({
        data: input.slots.map((slot) => ({
          projectId: input.projectId,
          name: slot.name,
          weekday: slot.weekday,
          minutesFromMidnight: slot.minutesFromMidnight,
          timezone: input.timezone,
        })),
      });
    }
    return listSocialQueueSlots(input, tx);
  }, "Queue times were modified, reload and retry");
}

export async function resolveNextSocialQueueSlot(
  input: ResolveNextSocialQueueSlotInput,
  tx: Prisma.TransactionClient = prisma,
  from = new Date(),
): Promise<{ scheduledAt: Date; timezone: string }> {
  const { slots } = await listSocialQueueSlots(input, tx);
  if (slots.length === 0) {
    throw badRequest("Add at least one queue time");
  }
  const occupied = await tx.socialPost.findMany({
    where: {
      projectId: input.projectId,
      socialConnectionId: input.socialConnectionId,
      status: { in: [...QUEUE_OCCUPIED_STATUSES] },
      scheduledAt: {
        gte: from,
        lte: new Date(from.getTime() + QUEUE_LOOKAHEAD_MS),
      },
    },
    select: { scheduledAt: true },
  });
  const scheduledAt = nextSocialQueueSlotAt(
    slots,
    occupied.flatMap((post) => (post.scheduledAt ? [post.scheduledAt] : [])),
    from,
    SOCIAL_POST_MIN_SCHEDULE_LEAD_MS,
  );
  if (!scheduledAt) {
    throw conflict("The queue is full for the next 12 weeks");
  }
  return { scheduledAt, timezone: slots[0].timezone };
}

export async function queueSocialPost(
  input: QueueSocialPostInput,
): Promise<SocialPostSummary> {
  return serializableTransaction(async (tx) => {
    const post = await getSocialPost(input, tx);
    const socialConnectionId =
      input.socialConnectionId ?? post.socialConnection?.id;
    if (!socialConnectionId) {
      throw badRequest("A social connection is required to schedule a post");
    }
    const next = await resolveNextSocialQueueSlot(
      { ...input, socialConnectionId },
      tx,
    );
    return scheduleSocialPost(
      {
        ...input,
        scheduledAt: next.scheduledAt,
        timezone: next.timezone,
      },
      tx,
    );
  }, "The queue was modified, reload and retry");
}
