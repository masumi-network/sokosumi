import { getSokoBotVersion } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
} from "../soko-bot-runtime.service";

/**
 * An ambiguous destination is asked, not guessed. When the owner asks for a
 * post and more than one connected account could take it, Core lets a draft
 * through only on an account the owner named exactly (its @handle or id, in
 * their own words, not in quoted copy), or one the bot picked from the
 * options of a question that was actually shown. Core reads no other words:
 * which option an answer means is the model's call, made explicit as the
 * socialConnectionId it passes.
 */

/** Starts the refusal, which records the options it showed, in order. */
export const ASK_WHICH_ACCOUNT = "Several accounts could take this post";
/** A question stays open this long, over this many turns, until a post is saved. */
const ANSWER_WINDOW_MS = 24 * 60 * 60 * 1_000;
const OPEN_QUESTION_TURNS = 5;
const SHOWN = 10;

interface Candidate {
  id: string;
  externalHandle: string | null;
  project: { id: string; name: string };
}

const handleOf = (candidate: Candidate) =>
  candidate.externalHandle?.replace(/^@/, "") ?? null;

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

/** Where the text names this account exactly (@handle or id), or -1. */
function namedAt(text: string, candidate: Candidate): number {
  const lower = text.toLowerCase();
  const handle = handleOf(candidate)?.toLowerCase();
  const places = [lower.indexOf(candidate.id.toLowerCase())];
  if (handle) {
    const pattern = new RegExp(
      `@${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`,
      "iu",
    );
    places.push(lower.search(pattern));
  }
  const found = places.filter((index) => index >= 0);
  return found.length ? Math.min(...found) : -1;
}

/** The accounts this text names exactly, in the order it names them. */
function namedIn(text: string, candidates: readonly Candidate[]): Candidate[] {
  return candidates
    .map((candidate) => ({ candidate, at: namedAt(text, candidate) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.candidate);
}

function label(candidate: Candidate): string {
  const handle = handleOf(candidate);
  return `${handle ? `@${handle}` : "an account"} (Project "${candidate.project.name}", projectId ${candidate.project.id}, socialConnectionId ${candidate.id})`;
}

function labels(candidates: readonly Candidate[]): string {
  const shown = candidates.slice(0, SHOWN).map(label).join("; ");
  const more = candidates.length - SHOWN;
  return more > 0
    ? `${shown}; and ${more} more (list_project_social_accounts)`
    : shown;
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
 * The options of the account question still open in this chat, in the order
 * they were shown: Core's refusal (its record), or a reply of the bot that
 * listed two or more accounts by @handle. A post saved since closes it.
 */
async function openQuestion(
  authorized: AuthorizedSokoBotRuntime,
  current: { createdAt: Date; destinationRoomId: string | null },
  candidates: readonly Candidate[],
): Promise<Candidate[] | null> {
  const recent = await prisma.sokoBotTurn.findMany({
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
    take: OPEN_QUESTION_TURNS,
    select: {
      status: true,
      finalAnswer: true,
      toolCalls: {
        where: {
          capability: "create_social_post",
          OR: [
            { status: "COMPLETED" },
            {
              status: "FAILED",
              errorDetail: { startsWith: ASK_WHICH_ACCOUNT },
            },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { status: true, errorDetail: true },
      },
    },
  });
  for (const previous of recent) {
    if (previous.toolCalls.some((call) => call.status === "COMPLETED"))
      return null;
    const refusal = previous.toolCalls.find((call) => call.errorDetail);
    if (refusal?.errorDetail) {
      const shown = namedIn(refusal.errorDetail, candidates);
      if (shown.length > 1) return shown;
    }
    if (previous.status === "COMPLETED") {
      const listed = namedIn(previous.finalAnswer ?? "", candidates);
      if (listed.length > 1) return listed;
    }
  }
  return null;
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
    select: { userMessage: true, createdAt: true, destinationRoomId: true },
  });
  const pick = candidates.find(
    (candidate) => candidate.id === params.socialConnectionId,
  );
  const named = namedIn(withoutQuotedCopy(turn.userMessage), candidates);
  if (named.length > 0) {
    if (pick && named.includes(pick)) return;
    throw new SokoBotRefusedUnsentError(
      `The owner named ${labels(named)}. Create the post there, with that socialConnectionId and projectId.`,
    );
  }
  const options = await openQuestion(authorized, turn, candidates);
  if (options) {
    if (pick && options.includes(pick)) return;
    throw new SokoBotRefusedUnsentError(
      `Pass the socialConnectionId and projectId of the option the owner picked, once they have picked one: ${labels(options)}. Until then, draft nothing.`,
    );
  }
  throw new SokoBotRefusedUnsentError(
    `${ASK_WHICH_ACCOUNT}, and the owner has not named one: ${labels(candidates)}. Ask the owner once which one, listing them by @handle in this order, and draft nothing until they answer. Then create the post with the socialConnectionId and projectId of the one they picked.`,
  );
}
