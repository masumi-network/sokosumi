import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { channelSlugWithId } from "@/helpers/channel-slug";

export interface QuestionRoomCoworker {
  id: string;
  name: string;
  slug: string;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

/**
 * The private channel where a bot asks Coworkers something with its owner
 * watching: exactly the owner, the bot and these Coworkers. Reused while its
 * roster is still exactly that, so asking Elena twice continues one
 * conversation; a room the owner has since widened is left alone, because a
 * question meant for the owner's eyes must not reach a teammate they added.
 *
 * A channel, not a Direct: a Direct cannot mix people, Coworkers and
 * assistants.
 */
export async function createOrGetCoworkerQuestionRoom(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    ownerUserId: string;
    sokoBotId: string;
    coworkers: readonly QuestionRoomCoworker[];
  },
): Promise<{ id: string; name: string; created: boolean }> {
  const coworkerIds = params.coworkers.map(({ id }) => id);
  const candidates = await tx.chatRoom.findMany({
    where: {
      organizationId: params.organizationId,
      kind: "channel",
      discoverability: "private",
      archivedAt: null,
      userMembers: { some: { userId: params.ownerUserId } },
      sokoBotMembers: { some: { sokoBotId: params.sokoBotId } },
      coworkerMembers: { some: { coworkerId: { in: coworkerIds } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      name: true,
      userMembers: { select: { userId: true } },
      coworkerMembers: { select: { coworkerId: true } },
      sokoBotMembers: { select: { sokoBotId: true } },
    },
  });
  const existing = candidates.find(
    (room) =>
      sameIds(
        room.userMembers.map(({ userId }) => userId),
        [params.ownerUserId],
      ) &&
      sameIds(
        room.sokoBotMembers.map(({ sokoBotId }) => sokoBotId),
        [params.sokoBotId],
      ) &&
      sameIds(
        room.coworkerMembers.map(({ coworkerId }) => coworkerId),
        coworkerIds,
      ),
  );
  if (existing) return { id: existing.id, name: existing.name, created: false };

  const name = `Ask ${params.coworkers.map((coworker) => coworker.name).join(", ")}`;
  const room = await tx.chatRoom.create({
    data: {
      organizationId: params.organizationId,
      createdByUserId: params.ownerUserId,
      name,
      slug: channelSlugWithId(name, randomUUID(), "ask"),
      discoverability: "private",
      userMembers: {
        create: [{ userId: params.ownerUserId, access: "member" }],
      },
      readStates: { create: [{ userId: params.ownerUserId }] },
      coworkerMembers: {
        create: coworkerIds.map((coworkerId) => ({ coworkerId })),
      },
      sokoBotMembers: { create: [{ sokoBotId: params.sokoBotId }] },
    },
    select: { id: true, name: true },
  });
  return { ...room, created: true };
}

/** The question with each Coworker it does not already address mentioned up front. */
export function addressCoworkers(
  question: string,
  coworkers: readonly QuestionRoomCoworker[],
  isMentioned: (coworker: QuestionRoomCoworker) => boolean,
): string {
  const missing = coworkers.filter((coworker) => !isMentioned(coworker));
  if (missing.length === 0) return question;
  return `${missing.map((coworker) => `@${coworker.slug}`).join(" ")} ${question}`;
}
