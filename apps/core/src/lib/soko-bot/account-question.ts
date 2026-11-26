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

/**
 * The account question still open in this chat: asked on an earlier turn of
 * this bot for this owner in the same room, delivered (that turn completed
 * with a reply), less than a day old, and not used by another turn.
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
      createdAt: {
        lt: scope.turnCreatedAt,
        gte: new Date(scope.turnCreatedAt.getTime() - ACCOUNT_QUESTION_OPEN_MS),
      },
      OR: [{ answeredTurnId: null }, { answeredTurnId: scope.turnId }],
      // Delivered: the reply that asked reached the chat (a room delivery
      // that failed or was held back leaves the question unasked). The
      // Personal Assistant page shows the turn's own answer, so its room
      // delivery is recorded as suppressed for that page.
      turn: {
        status: "COMPLETED",
        finalAnswer: { not: null },
        OR: [
          { deliveries: { none: {} } },
          {
            deliveries: {
              some: {
                OR: [
                  { status: { in: ["PERSISTED", "PUBLISHED"] } },
                  { status: "SUPPRESSED", reason: "ASSISTANT_PAGE" },
                ],
              },
            },
          },
        ],
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, optionIds: true },
  });
  if (!question) return null;
  const options = await prisma.projectSocialConnection.findMany({
    where: { id: { in: question.optionIds } },
    select: {
      id: true,
      externalHandle: true,
      projectId: true,
      project: { select: { name: true } },
    },
  });
  const byId = new Map(options.map((option) => [option.id, option]));
  return {
    id: question.id,
    options: question.optionIds.flatMap((id) => {
      const option = byId.get(id);
      return option ? [option] : [];
    }),
  };
}

/** For the next owner turn's packet: what to pass, and never to show. */
export function accountQuestionHint(
  question: NonNullable<Awaited<ReturnType<typeof openAccountQuestion>>>,
): string {
  const options = question.options
    .map(
      (option) =>
        `${option.externalHandle ? `@${option.externalHandle.replace(/^@/, "")}` : "an account"} (Project "${option.project.name}", projectId ${option.projectId}, socialConnectionId ${option.id})`,
    )
    .join("; ");
  // Which option "the first one" or "the Sokosumi one" means is read from
  // the reply the owner saw, in the history: Core stores what was offered,
  // not how the reply put it.
  return `You asked the owner which account a post should go on, and the question is open: accountQuestionId ${question.id}, offered accounts: ${options}. If this message picks one, match it to your last reply as the owner read it, then create the post with that accountQuestionId and the option's socialConnectionId and projectId. If it is unclear which one they mean, ask again. These ids are for the tool: never show them to the owner.`;
}
