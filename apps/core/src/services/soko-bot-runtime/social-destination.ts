import type { Prisma } from "@sokosumi/database";
import { getSokoBotVersion } from "@sokosumi/soko-bot";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { openAccountQuestion } from "@/lib/soko-bot/account-question";
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
 * Accepts the pick only for a question still open in this chat (delivered
 * on an earlier turn, same room, owner and bot, not used by another turn)
 * whose options hold it. Nothing is claimed here: the draft's own save
 * claims it (claimAccountQuestion), so a draft that fails leaves it open.
 */
async function acceptAnswer(
  authorized: AuthorizedSokoBotRuntime,
  questionId: string,
  pick: string | null | undefined,
): Promise<string> {
  const current = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: authorized.turn.id },
    select: { createdAt: true, destinationRoomId: true },
  });
  const question = await openAccountQuestion(
    {
      sokoBotId: authorized.turn.sokoBotId,
      requestedByUserId: authorized.turn.requestedByUserId,
      destinationRoomId: current.destinationRoomId,
      turnId: authorized.turn.id,
      turnCreatedAt: current.createdAt,
    },
    questionId,
  );
  if (!question)
    throw new SokoBotRefusedUnsentError(
      "That account question is not open in this chat: it was not delivered, was asked on this turn, in another room or more than a day ago, or another turn used it. Create the post without accountQuestionId to ask again.",
    );
  if (!pick || !question.options.some((option) => option.id === pick))
    throw new SokoBotRefusedUnsentError(
      `Pass the socialConnectionId of the option the owner picked: one of ${question.options.map((option) => option.id).join(", ")}.`,
    );
  return question.id;
}

/**
 * Inside the transaction that saves the draft: the answering turn takes the
 * question, so a second turn cannot reuse it, and the same turn may draft
 * on several of its options. A draft that rolls back leaves it open.
 */
export async function claimAccountQuestion(
  tx: Prisma.TransactionClient,
  questionId: string,
  turnId: string,
): Promise<void> {
  const claimed = await tx.sokoBotAccountQuestion.updateMany({
    where: {
      id: questionId,
      OR: [{ answeredTurnId: null }, { answeredTurnId: turnId }],
    },
    data: { answeredTurnId: turnId },
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
): Promise<{ answersQuestionId?: string }> {
  if (!ownersOwnChat(authorized)) return {};
  // Cuso posts for his one Project, on the accounts its plan names.
  if (getSokoBotVersion(authorized.turn.versionId).profile === "cmo") return {};
  if (params.accountQuestionId)
    return {
      answersQuestionId: await acceptAnswer(
        authorized,
        params.accountQuestionId,
        params.socialConnectionId,
      ),
    };
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
  if (candidates.length < 2) return {};
  const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: authorized.turn.id },
    select: { userMessage: true, destinationRoomId: true },
  });
  const named = namedIn(turn.userMessage, candidates);
  if (named.length > 0) {
    if (named.some((candidate) => candidate.id === params.socialConnectionId))
      return {};
    throw new SokoBotRefusedUnsentError(
      `The owner named ${labels(named)}. Create the post there, with that socialConnectionId and projectId.`,
    );
  }
  const question = await askOnce(authorized, {
    provider,
    destinationRoomId: turn.destinationRoomId,
    optionIds: candidates.slice(0, SHOWN).map((candidate) => candidate.id),
  });
  const byId = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const options = question.optionIds.flatMap((id) => {
    const option = byId.get(id);
    return option ? [option] : [];
  });
  const more = candidates.length - options.length;
  throw new SokoBotRefusedUnsentError(
    `${ASK_WHICH_ACCOUNT}, and the owner has not named one. Account question ${question.id}, offered accounts: ${labels(options)}${more > 0 ? `; ${more} more are connected (the owner can name one by @handle)` : ""}. Ask the owner once which one, listing these, and draft nothing on this turn. After they answer, create the post with accountQuestionId ${question.id} and the socialConnectionId and projectId of the option they picked.`,
  );
}

/**
 * One question per asking turn and provider (a unique key): a second or
 * concurrent refusal on the turn repeats the stored question and its options.
 */
async function askOnce(
  authorized: AuthorizedSokoBotRuntime,
  input: {
    provider: string;
    destinationRoomId: string | null;
    optionIds: string[];
  },
): Promise<{ id: string; optionIds: string[] }> {
  const key = {
    turnId_provider: { turnId: authorized.turn.id, provider: input.provider },
  };
  const select = { id: true, optionIds: true } as const;
  const asked = await prisma.sokoBotAccountQuestion.findUnique({
    where: key,
    select,
  });
  if (asked) return asked;
  try {
    return await prisma.sokoBotAccountQuestion.create({
      data: {
        sokoBotId: authorized.turn.sokoBotId,
        turnId: authorized.turn.id,
        requestedByUserId: authorized.turn.requestedByUserId,
        ...input,
      },
      select,
    });
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) throw error;
    return prisma.sokoBotAccountQuestion.findUniqueOrThrow({
      where: key,
      select,
    });
  }
}
