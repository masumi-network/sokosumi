import { getSokoBotVersion } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
} from "../soko-bot-runtime.service";

/**
 * An ambiguous destination is asked, not guessed. When the owner asks for a
 * post and more than one connected account could take it, the owner must
 * have chosen one: by its @handle, its id, or its Project's name, either in
 * this message or in answer to the bot's question on the turn before.
 * Otherwise Core refuses the draft with the question to ask. Asking only from
 * the skill failed every time: the bot drafted on one account first.
 */

/** Starts the refusal; the next turn finds it to know the question was asked. */
export const ASK_WHICH_ACCOUNT = "Several accounts could take this post";
/** An answer belongs to a question asked this recently in the same chat. */
const ANSWER_WINDOW_MS = 24 * 60 * 60 * 1_000;

interface Candidate {
  id: string;
  externalHandle: string | null;
  project: { id: string; name: string };
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The whole word or phrase, never a piece of a longer word ("Pat" in "patch"). */
function says(text: string, phrase: string): boolean {
  const value = phrase.trim();
  if (value.length < 2) return false;
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escape(value)}(?![\\p{L}\\p{N}_])`,
    "iu",
  ).test(text);
}

const handleOf = (candidate: Candidate) =>
  candidate.externalHandle?.replace(/^@/, "") ?? null;

/** The owner picked this account itself: its @handle or its id. */
function namedAccount(text: string, candidate: Candidate): boolean {
  const handle = handleOf(candidate);
  return (
    (handle !== null && says(text, `@${handle}`)) || text.includes(candidate.id)
  );
}

/** The owner picked it by handle, id or Project name. */
function chosen(text: string, candidate: Candidate): boolean {
  const handle = handleOf(candidate);
  return (
    namedAccount(text, candidate) ||
    (handle !== null && says(text, handle)) ||
    says(text, candidate.project.name) ||
    text.includes(candidate.project.id)
  );
}

function label(candidate: Candidate): string {
  const handle = handleOf(candidate);
  return `${handle ? `@${handle}` : "an account"} (Project "${candidate.project.name}", projectId ${candidate.project.id}, socialConnectionId ${candidate.id})`;
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
 * The bot's previous turn in this chat asked which account: Core refused a
 * draft with the question, or the bot asked on its own, naming two of them.
 */
async function askedJustBefore(
  authorized: AuthorizedSokoBotRuntime,
  current: { createdAt: Date; destinationRoomId: string | null },
  candidates: readonly Candidate[],
): Promise<boolean> {
  const previous = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId: authorized.turn.sokoBotId,
      requestedByUserId: authorized.turn.requestedByUserId,
      destinationRoomId: current.destinationRoomId,
      source: "CHAT",
      id: { not: authorized.turn.id },
      createdAt: {
        lt: current.createdAt,
        gte: new Date(current.createdAt.getTime() - ANSWER_WINDOW_MS),
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      finalAnswer: true,
      toolCalls: {
        where: {
          capability: "create_social_post",
          status: "FAILED",
          errorDetail: { startsWith: ASK_WHICH_ACCOUNT },
        },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!previous) return false;
  if (previous.toolCalls.length > 0) return true;
  const answer = previous.finalAnswer ?? "";
  return candidates.filter((candidate) => chosen(answer, candidate)).length > 1;
}

export async function requireChosenSocialDestination(
  authorized: AuthorizedSokoBotRuntime,
  params: { projectId: string; socialConnectionId?: string | null },
): Promise<void> {
  if (!ownersOwnChat(authorized)) return;
  // Cuso posts for his one Project, on the accounts its plan names.
  if (getSokoBotVersion(authorized.turn.versionId).profile === "cmo") return;
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
        project: { workspaceId: authorized.turn.workspaceId },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 10,
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
    select: { userMessage: true, createdAt: true, destinationRoomId: true },
  });
  const message = turn.userMessage;
  const pick = candidates.find(
    (candidate) => candidate.id === params.socialConnectionId,
  );
  if (pick && chosen(message, pick)) return;
  // Only an explicit @handle or id redirects; a name may be the post's topic.
  const accounts = candidates.filter((candidate) =>
    namedAccount(message, candidate),
  );
  if (accounts.length > 0)
    throw new SokoBotRefusedUnsentError(
      `The owner chose ${accounts.map(label).join("; ")}. Create the post there, with that socialConnectionId and projectId.`,
    );
  if (await askedJustBefore(authorized, turn, candidates)) {
    if (pick) return;
    throw new SokoBotRefusedUnsentError(
      `Pass the socialConnectionId and projectId of the account the owner chose: ${candidates.map(label).join("; ")}.`,
    );
  }
  throw new SokoBotRefusedUnsentError(
    `${ASK_WHICH_ACCOUNT}, and the owner has not chosen one: ${candidates.map(label).join("; ")}. Ask the owner once which one, naming them, and draft nothing until they answer. Then create the post with that account's socialConnectionId and projectId.`,
  );
}
