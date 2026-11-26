import { getSokoBotVersion } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
} from "../soko-bot-runtime.service";

/**
 * An ambiguous destination is asked, not guessed. When the owner asks for a
 * post and more than one connected account could take it, the draft goes
 * where the owner chose: an @handle, an id or a Project name in their own
 * words (quoted copy is the post), or their answer to the bot's question on
 * the turn before. Otherwise Core refuses the draft with the question to ask.
 * Asking only from the skill failed every time: the bot drafted first.
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

const handleOf = (candidate: Candidate) =>
  candidate.externalHandle?.replace(/^@/, "") ?? null;

/** "not @acme", "instead of Acme": a name the owner turned down. */
const REFUSAL =
  /(?:\bnot|\bno|\bnever|\bexcept|\binstead of|\brather than)\s+(?:on\s+|the\s+)?$/iu;

/**
 * The owner says this name as a whole word ("Pat" never in "patch"), and not
 * in order to turn it down.
 */
function saysFor(text: string, phrase: string): boolean {
  const value = phrase.trim();
  if (value.length < 2) return false;
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escape(value)}(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(0, (match.index ?? 0) + (match[1]?.length ?? 0));
    if (!REFUSAL.test(before)) return true;
  }
  return false;
}

/** The owner's own words: quoted or fenced text is the post, never where it goes. */
export function withoutQuotedCopy(message: string): string {
  return message
    .replaceAll(/```[\s\S]*?```/g, " ")
    .replaceAll(/"[^"]*"|“[^”]*”|«[^»]*»|„[^“”]*[“”]/g, " ")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
}

/** The owner picked this account itself: its @handle or its id. */
function namedAccount(text: string, candidate: Candidate): boolean {
  const handle = handleOf(candidate);
  return (
    (handle !== null && saysFor(text, `@${handle}`)) ||
    saysFor(text, candidate.id)
  );
}

/** Named by @handle or id, or by Project name or id. */
function mentioned(text: string, candidate: Candidate): boolean {
  return (
    namedAccount(text, candidate) ||
    saysFor(text, candidate.project.name) ||
    saysFor(text, candidate.project.id)
  );
}

const place = (word: string, digit: number) =>
  new RegExp(
    `\\b(${word})\\b|(#|\\boption |\\bnumber |\\bno\\. ?)${digit}\\b`,
    "iu",
  );
const ORDINALS: [RegExp, (count: number) => number][] = [
  [place("first|1st|former", 1), () => 0],
  [place("second|2nd", 2), () => 1],
  [place("third|3rd", 3), () => 2],
  [/\b(last|latter)\b/iu, (count) => count - 1],
];

/**
 * The accounts the owner chose, or null when their words do not say. Names
 * win; a place in the list ("the second one", "both") only answers a
 * question that listed them, in that order.
 */
export function resolveChoice(
  message: string,
  candidates: readonly Candidate[],
  asked: readonly Candidate[] | null,
): Candidate[] | null {
  const text = withoutQuotedCopy(message);
  const accounts = candidates.filter((candidate) =>
    namedAccount(text, candidate),
  );
  if (accounts.length > 0) return accounts;
  const byProject = candidates.filter((candidate) =>
    mentioned(text, candidate),
  );
  // One Project can hold a personal and a company account of a network.
  const projects = new Set(byProject.map((candidate) => candidate.project.id));
  if (byProject.length > 0 && byProject.length === projects.size)
    return byProject;
  if (!asked) return null;
  if (/\b(both|all( of them)?)\b/iu.test(text)) return [...asked];
  for (const [pattern, index] of ORDINALS) {
    const pick = pattern.test(text) ? asked[index(asked.length)] : undefined;
    if (pick) return [pick];
  }
  return null;
}

const SHOWN = 10;

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
 * The accounts the bot's previous turn in this chat asked about, in the order
 * it listed them, or null when it asked nothing: Core refused a draft with
 * the question, or the bot asked on its own, naming two of them.
 */
async function askedJustBefore(
  authorized: AuthorizedSokoBotRuntime,
  current: { createdAt: Date; destinationRoomId: string | null },
  candidates: readonly Candidate[],
): Promise<Candidate[] | null> {
  const previous = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId: authorized.turn.sokoBotId,
      requestedByUserId: authorized.turn.requestedByUserId,
      destinationRoomId: current.destinationRoomId,
      source: "CHAT",
      id: { not: authorized.turn.id },
      // A turn that failed asked nothing, unless Core's refusal did.
      OR: [
        { status: "COMPLETED" },
        {
          toolCalls: {
            some: {
              capability: "create_social_post",
              errorDetail: { startsWith: ASK_WHICH_ACCOUNT },
            },
          },
        },
      ],
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
  if (!previous) return null;
  const question = previous.finalAnswer ?? "";
  const listed = candidates
    .map((candidate) => ({ candidate, at: firstMention(question, candidate) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.candidate);
  if (listed.length > 1) return listed;
  // Core's refusal listed them oldest first; the bot relays that list.
  return previous.toolCalls.length > 0 ? [...candidates] : null;
}

/** Where the question first names this account (@handle or Project), or -1. */
function firstMention(text: string, candidate: Candidate): number {
  const handle = handleOf(candidate);
  const lower = text.toLowerCase();
  const places = [
    handle ? lower.indexOf(`@${handle.toLowerCase()}`) : -1,
    lower.indexOf(candidate.project.name.toLowerCase()),
  ].filter((index) => index >= 0);
  return places.length ? Math.min(...places) : -1;
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
  const asked = await askedJustBefore(authorized, turn, candidates);
  const choice = resolveChoice(turn.userMessage, candidates, asked);
  if (choice) {
    if (pick && choice.includes(pick)) return;
    throw new SokoBotRefusedUnsentError(
      `The owner chose ${labels(choice)}. Create the post there, with that socialConnectionId and projectId.`,
    );
  }
  // An answer Core cannot read ("my personal one"): the bot read it, but
  // only an account the question offered can be the answer.
  if (asked) {
    if (pick && asked.includes(pick)) return;
    throw new SokoBotRefusedUnsentError(
      `Create the post on the account the owner chose from your question, with its socialConnectionId and projectId: ${labels(asked)}.`,
    );
  }
  throw new SokoBotRefusedUnsentError(
    `${ASK_WHICH_ACCOUNT}, and the owner has not chosen one: ${labels(candidates)}. Ask the owner once which one, naming them, and draft nothing until they answer. Then create the post with that account's socialConnectionId and projectId.`,
  );
}
