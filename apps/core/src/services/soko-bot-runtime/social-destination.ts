import { getSokoBotVersion } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
} from "../soko-bot-runtime.service";

/**
 * An ambiguous destination is asked, not guessed. When the owner asks for a
 * post and more than one connected account could take it, a draft goes
 * through on an account the owner named exactly in their request (its
 * @handle or id, or a Project holding only that account, outside quoted
 * copy), or on an answer to a recorded account question: Core stores the
 * question with its options when it refuses, and a later owner chat turn
 * passes its id with the option the owner picked. What the owner's words
 * mean is the model's call; Core checks only ids.
 */

/** Starts the refusal that records a question. */
export const ASK_WHICH_ACCOUNT = "Several accounts could take this post";
/** An unanswered question stays open this long. */
const OPEN_MS = 24 * 60 * 60 * 1_000;
const SHOWN = 10;

interface Candidate {
  id: string;
  externalHandle: string | null;
  project: { id: string; name: string };
}

const handleOf = (candidate: Candidate) =>
  candidate.externalHandle?.replace(/^@/, "") ?? null;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The owner's own words: quoted or fenced text is the post, never where it goes. */
export function withoutQuotedCopy(message: string): string {
  return message
    .replaceAll(/```[\s\S]*?```/g, " ")
    .replaceAll(/"[^"]*"|“[^”]*”|‘[^’]*’|«[^»]*»|„[^“”]*[“”]/g, " ")
    .replaceAll(/(^|[\s(:])'[^'\n]+'(?=[\s.,!?;:)]|$)/g, "$1 ")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
}

/** The exact name, never part of a longer one. */
function contains(text: string, name: string): boolean {
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_@])${escape(name)}(?![\\p{L}\\p{N}_])`,
    "iu",
  ).test(text);
}

/**
 * The accounts the request names exactly: an @handle or id, or a Project
 * name when that Project holds only one of the fitting accounts.
 */
function namedIn(
  message: string,
  candidates: readonly Candidate[],
): Candidate[] {
  const text = withoutQuotedCopy(message);
  return candidates.filter((candidate) => {
    const handle = handleOf(candidate);
    if (handle && contains(text, `@${handle}`)) return true;
    if (text.includes(candidate.id)) return true;
    const sameProject = candidates.filter(
      (other) => other.project.id === candidate.project.id,
    );
    return (
      sameProject.length === 1 &&
      candidate.project.name.trim().length > 0 &&
      contains(text, candidate.project.name.trim())
    );
  });
}

function label(candidate: Candidate): string {
  const handle = handleOf(candidate);
  return `${handle ? `@${handle}` : "an account"} (Project "${candidate.project.name}", projectId ${candidate.project.id}, socialConnectionId ${candidate.id})`;
}

function labels(candidates: readonly Candidate[]): string {
  return candidates.map(label).join("; ");
}

/** The owner's own chat turn: the only turn that asks the owner anything. */
function ownersOwnChat(authorized: AuthorizedSokoBotRuntime): boolean {
  return (
    authorized.turn.source === "CHAT" &&
    authorized.turn.chainDepth === 0 &&
    authorized.askedByKind === "OWNER"
  );
}

/**
 * Accepts the pick only for an open question of this bot and owner, asked
 * before this turn (so the owner has written since), whose options hold it.
 * The turn that answers may draft on several of its options.
 */
async function acceptAnswer(
  authorized: AuthorizedSokoBotRuntime,
  questionId: string,
  pick: string | null | undefined,
): Promise<void> {
  const [question, current] = await Promise.all([
    prisma.sokoBotAccountQuestion.findUnique({ where: { id: questionId } }),
    prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: authorized.turn.id },
      select: { createdAt: true },
    }),
  ]);
  const open =
    question !== null &&
    question.sokoBotId === authorized.turn.sokoBotId &&
    question.requestedByUserId === authorized.turn.requestedByUserId &&
    question.turnId !== authorized.turn.id &&
    question.createdAt < current.createdAt &&
    current.createdAt.getTime() - question.createdAt.getTime() < OPEN_MS &&
    (question.answeredTurnId === null ||
      question.answeredTurnId === authorized.turn.id);
  if (!open)
    throw new SokoBotRefusedUnsentError(
      "That account question is not open on this turn: it was asked on this same turn, by someone else, more than a day ago, or already answered. Create the post without accountQuestionId to ask again.",
    );
  if (!pick || !question.optionIds.includes(pick))
    throw new SokoBotRefusedUnsentError(
      `Pass the socialConnectionId of the option the owner picked: one of ${question.optionIds.join(", ")}.`,
    );
  const claimed = await prisma.sokoBotAccountQuestion.updateMany({
    where: {
      id: question.id,
      OR: [{ answeredTurnId: null }, { answeredTurnId: authorized.turn.id }],
    },
    data: { answeredTurnId: authorized.turn.id },
  });
  if (claimed.count === 0)
    throw new SokoBotRefusedUnsentError(
      "That account question was just answered on another turn.",
    );
}

export async function requireChosenSocialDestination(
  authorized: AuthorizedSokoBotRuntime,
  params: {
    projectId: string;
    socialConnectionId?: string | null;
    accountQuestionId?: string;
  },
): Promise<void> {
  if (!ownersOwnChat(authorized)) return;
  // Cuso posts for his one Project, on the accounts its plan names.
  if (getSokoBotVersion(authorized.turn.versionId).profile === "cmo") return;
  if (params.accountQuestionId)
    return acceptAnswer(
      authorized,
      params.accountQuestionId,
      params.socialConnectionId,
    );
  const picked = params.socialConnectionId
    ? await prisma.projectSocialConnection.findFirst({
        where: { id: params.socialConnectionId, projectId: params.projectId },
        select: { provider: true },
      })
    : null;
  // Without an account the post is checked as an X post (social-posts).
  const provider = picked?.provider ?? "x";
  const candidates: Candidate[] = await prisma.projectSocialConnection.findMany(
    {
      where: {
        provider,
        status: "active",
        project: {
          workspaceId: authorized.turn.workspaceId,
          closedAt: null,
          closingAt: null,
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        externalHandle: true,
        project: { select: { id: true, name: true } },
      },
    },
  );
  if (candidates.length < 2) return;
  const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: authorized.turn.id },
    select: { userMessage: true, destinationRoomId: true },
  });
  const named = namedIn(turn.userMessage, candidates);
  if (named.length > 0) {
    if (named.some((candidate) => candidate.id === params.socialConnectionId))
      return;
    throw new SokoBotRefusedUnsentError(
      `The owner named ${labels(named)}. Create the post there, with that socialConnectionId and projectId.`,
    );
  }
  const options = candidates.slice(0, SHOWN);
  const question = await prisma.sokoBotAccountQuestion.create({
    data: {
      sokoBotId: authorized.turn.sokoBotId,
      turnId: authorized.turn.id,
      requestedByUserId: authorized.turn.requestedByUserId,
      destinationRoomId: turn.destinationRoomId,
      provider,
      optionIds: options.map((candidate) => candidate.id),
    },
    select: { id: true },
  });
  const more = candidates.length - options.length;
  throw new SokoBotRefusedUnsentError(
    `${ASK_WHICH_ACCOUNT}, and the owner has not named one. Account question ${question.id}, options in order: ${labels(options)}${more > 0 ? `; ${more} more are connected (the owner can name one by @handle)` : ""}. Ask the owner once which one, listing these, and draft nothing on this turn. After they answer, create the post with accountQuestionId ${question.id} and the socialConnectionId and projectId of the option they picked.`,
  );
}
