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
 * The channel where a bot asks Coworkers something with the person who asked
 * watching: exactly that person, the bot and these Coworkers. Reused while
 * its roster is still exactly that, so asking Elena twice continues one
 * conversation; a room widened since is left alone.
 *
 * A personal bot's room is private: a question meant for its owner's eyes
 * must not reach a teammate. A shared bot's room is public, because every
 * member may read what a shared bot does (ADR 0057), and it never reuses a
 * private one.
 *
 * A channel, not a Direct: a Direct cannot mix people, Coworkers and
 * assistants.
 */
export async function createOrGetCoworkerQuestionRoom(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    /** A personal bot's owner, or the member who asked a shared bot. */
    memberUserId: string;
    sokoBotId: string;
    coworkers: readonly QuestionRoomCoworker[];
    /** Other assistants asked with them (send_message). */
    assistants?: readonly { id: string; name: string }[];
    discoverability: "private" | "public";
  },
): Promise<{ id: string; name: string; created: boolean }> {
  const coworkerIds = params.coworkers.map(({ id }) => id);
  const assistants = params.assistants ?? [];
  const botIds = [params.sokoBotId, ...assistants.map(({ id }) => id)];
  const candidates = await tx.chatRoom.findMany({
    where: {
      organizationId: params.organizationId,
      kind: "channel",
      discoverability: params.discoverability,
      archivedAt: null,
      userMembers: { some: { userId: params.memberUserId } },
      sokoBotMembers: { some: { sokoBotId: params.sokoBotId } },
      ...(coworkerIds.length
        ? { coworkerMembers: { some: { coworkerId: { in: coworkerIds } } } }
        : {}),
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
        [params.memberUserId],
      ) &&
      sameIds(
        room.sokoBotMembers.map(({ sokoBotId }) => sokoBotId),
        botIds,
      ) &&
      sameIds(
        room.coworkerMembers.map(({ coworkerId }) => coworkerId),
        coworkerIds,
      ),
  );
  if (existing) return { id: existing.id, name: existing.name, created: false };

  const name = `Ask ${[...params.coworkers, ...assistants].map((member) => member.name).join(", ")}`;
  const room = await tx.chatRoom.create({
    data: {
      organizationId: params.organizationId,
      createdByUserId: params.memberUserId,
      name,
      slug: channelSlugWithId(name, randomUUID(), "ask"),
      discoverability: params.discoverability,
      userMembers: {
        create: [{ userId: params.memberUserId, access: "member" }],
      },
      readStates: { create: [{ userId: params.memberUserId }] },
      coworkerMembers: {
        create: coworkerIds.map((coworkerId) => ({ coworkerId })),
      },
      sokoBotMembers: { create: botIds.map((sokoBotId) => ({ sokoBotId })) },
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
