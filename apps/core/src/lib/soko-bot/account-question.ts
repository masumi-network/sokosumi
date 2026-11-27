import type { Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";

/** An unanswered account question stays open this long. */
export const ACCOUNT_QUESTION_OPEN_MS = 24 * 60 * 60 * 1_000;

export interface AccountQuestionScope {
  sokoBotId: string;
  requestedByUserId: string | null;
  destinationRoomId: string | null;
  /** The turn now answering: the question must be older, and delivered. */
  turnId: string;
  turnCreatedAt: Date;
}

interface AccountOption {
  id: string;
  externalHandle: string | null;
  projectId: string;
  project: { name: string };
  /** Its number in the shown list, kept when an earlier option drops out. */
  number: number;
}

const OPTION_SELECT = {
  id: true,
  externalHandle: true,
  projectId: true,
  project: { select: { name: true } },
} as const;

/** Options that can still take a post (connected, in an open Project), in stored order. */
async function liveOptions(
  client: Prisma.TransactionClient,
  optionIds: readonly string[],
): Promise<AccountOption[]> {
  const options = await client.projectSocialConnection.findMany({
    where: {
      id: { in: [...optionIds] },
      status: "active",
      project: { closedAt: null, closingAt: null },
    },
    select: OPTION_SELECT,
  });
  const byId = new Map(options.map((option) => [option.id, option]));
  return optionIds.flatMap((id, index) => {
    const option = byId.get(id);
    return option ? [{ ...option, number: index + 1 }] : [];
  });
}

const handleOf = (option: AccountOption) =>
  option.externalHandle
    ? `@${option.externalHandle.replace(/^@/, "")}`
    : "an account";

/** What the owner reads: handle and Project, numbered, no ids. */
function shownOption(option: AccountOption, index: number): string {
  return `${index + 1}. ${handleOf(option)} (${option.project.name})`;
}

/** Stored order, renumbered: what Core shows when it asks. */
const asShown = (options: AccountOption[]) =>
  options.map((option, index) => ({ ...option, number: index + 1 }));

/**
 * Core asks the question itself, under the reply of the turn whose draft it
 * refused: the owner then sees exactly the stored options in the stored
 * order, and the question counts as shown. A turn that ends silent, or never
 * reaches its reply, leaves it unshown, so no later turn recalls it.
 */
export async function showAccountQuestion(
  tx: Prisma.TransactionClient,
  turnId: string,
): Promise<string | null> {
  const question = await tx.sokoBotAccountQuestion.findFirst({
    where: { turnId, answeredTurnId: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, optionIds: true },
  });
  if (!question) return null;
  const live = await liveOptions(tx, question.optionIds);
  if (live.length < 2) return null;
  const options = asShown(live);
  // What was shown is what is stored: the numbers the owner reads.
  await tx.sokoBotAccountQuestion.update({
    where: { id: question.id },
    data: {
      shownAt: new Date(),
      optionIds: options.map((option) => option.id),
    },
  });
  return `Which account should this go on?\n${options.map(shownOption).join("\n")}`;
}

/**
 * The account question still open in this chat: shown to the owner on an
 * earlier turn of this bot for this owner in the same room, delivered (that
 * turn completed with a reply), less than a day old, and not used by
 * another turn.
 */
export async function openAccountQuestion(
  scope: AccountQuestionScope,
  questionId?: string,
) {
  const question = await prisma.sokoBotAccountQuestion.findFirst({
    where: {
      ...(questionId ? { id: questionId } : {}),
      sokoBotId: scope.sokoBotId,
      requestedByUserId: scope.requestedByUserId,
      destinationRoomId: scope.destinationRoomId,
      turnId: { not: scope.turnId },
      shownAt: { not: null },
      createdAt: {
        lt: scope.turnCreatedAt,
        gte: new Date(scope.turnCreatedAt.getTime() - ACCOUNT_QUESTION_OPEN_MS),
      },
      OR: [{ answeredTurnId: null }, { answeredTurnId: scope.turnId }],
      // Delivered: the reply that asked reached the chat. A room turn needs
      // its delivery to that room (one that failed, was held back or never
      // made leaves the question unasked); the Personal Assistant page shows
      // the turn's own answer, so its room delivery is recorded as
      // suppressed for that page. A turn without a room has no delivery.
      turn: {
        status: "COMPLETED",
        finalAnswer: { not: null },
        ...(scope.destinationRoomId
          ? {
              deliveries: {
                some: {
                  roomId: scope.destinationRoomId,
                  OR: [
                    { status: { in: ["PERSISTED", "PUBLISHED"] } },
                    { status: "SUPPRESSED", reason: "ASSISTANT_PAGE" },
                  ],
                },
              },
            }
          : {}),
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, optionIds: true },
  });
  if (!question) return null;
  return {
    id: question.id,
    options: await liveOptions(prisma, question.optionIds),
  };
}

/** For the next owner turn's packet: what to pass, and never to show. */
export function accountQuestionHint(
  question: NonNullable<Awaited<ReturnType<typeof openAccountQuestion>>>,
): string {
  const options = question.options
    .map(
      (option) =>
        `${option.number}. ${handleOf(option)} (Project "${option.project.name}", projectId ${option.projectId}, socialConnectionId ${option.id})`,
    )
    .join("; ");
  return `Your last reply asked the owner which account a post should go on, and Core listed the options exactly in this order: accountQuestionId ${question.id}, ${options}. If this message picks one, create the post with that accountQuestionId and the option's socialConnectionId and projectId. If it is unclear which one they mean, ask again. These ids are for the tool: never show them to the owner.`;
}
