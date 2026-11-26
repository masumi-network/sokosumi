import { getSokoBotVersion } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
} from "../soko-bot-runtime.service";

/**
 * An ambiguous destination is asked, not guessed. When the owner asks for a
 * post and more than one connected account could take it, the owner's own
 * words must name one; otherwise Core refuses the draft with the question to
 * ask, and the owner's answer on the next turn lets it through. Asking only
 * from the skill failed every time: the bot drafted on one account first.
 */

/** Starts the refusal; the next turn finds it to know the question was asked. */
export const ASK_WHICH_ACCOUNT = "Several accounts could take this post";

interface Candidate {
  id: string;
  externalHandle: string | null;
  displayName: string | null;
  project: { id: string; name: string };
}

const normalize = (text: string) => text.toLowerCase().replaceAll("@", "");

/** Whether the owner's words name this account, its handle or its Project. */
function named(message: string, candidate: Candidate): boolean {
  const said = normalize(message);
  return [
    candidate.externalHandle,
    candidate.displayName,
    candidate.project.name,
  ].some((name) => {
    const value = name ? normalize(name).trim() : "";
    return value.length >= 3 && said.includes(value);
  });
}

function label(candidate: Candidate): string {
  const name = candidate.externalHandle
    ? `@${candidate.externalHandle.replace(/^@/, "")}`
    : (candidate.displayName ?? "an account");
  return `${name} (Project "${candidate.project.name}", projectId ${candidate.project.id}, socialConnectionId ${candidate.id})`;
}

/** The owner's own chat turn: the only turn that asks the owner anything. */
function ownersOwnChat(authorized: AuthorizedSokoBotRuntime): boolean {
  return (
    authorized.turn.source === "CHAT" &&
    authorized.turn.chainDepth === 0 &&
    authorized.askedByKind === "OWNER"
  );
}

/** The previous turn here asked which account: this turn holds the answer. */
async function askedAlready(
  authorized: AuthorizedSokoBotRuntime,
): Promise<boolean> {
  const previous = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId: authorized.turn.sokoBotId,
      requestedByUserId: authorized.turn.requestedByUserId,
      source: "CHAT",
      id: { not: authorized.turn.id },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
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
  return (previous?.toolCalls.length ?? 0) > 0;
}

export async function requireChosenSocialDestination(
  authorized: AuthorizedSokoBotRuntime,
  params: { projectId: string; socialConnectionId?: string | null },
): Promise<void> {
  if (!ownersOwnChat(authorized)) return;
  // Cuso posts for his one Project, on the accounts its plan names.
  if (getSokoBotVersion(authorized.turn.versionId).profile === "cmo") return;
  const chosen = params.socialConnectionId
    ? await prisma.projectSocialConnection.findFirst({
        where: { id: params.socialConnectionId, projectId: params.projectId },
        select: { provider: true },
      })
    : null;
  // Without an account the post is checked as an X post (social-posts).
  const provider = chosen?.provider ?? "x";
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
        displayName: true,
        project: { select: { id: true, name: true } },
      },
    },
  );
  if (candidates.length < 2) return;
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: authorized.turn.id },
    select: { userMessage: true },
  });
  const message = turn?.userMessage ?? "";
  const pick = candidates.find(
    (candidate) => candidate.id === params.socialConnectionId,
  );
  const namedByOwner = candidates.filter((candidate) =>
    named(message, candidate),
  );
  if (pick && namedByOwner.length > 0) {
    if (namedByOwner.includes(pick)) return;
    throw new SokoBotRefusedUnsentError(
      `The owner named ${namedByOwner.map(label).join("; ")}, not this account. Post there.`,
    );
  }
  if (pick && (await askedAlready(authorized))) return;
  throw new SokoBotRefusedUnsentError(
    `${ASK_WHICH_ACCOUNT}, and the owner named none: ${candidates.map(label).join("; ")}. Ask the owner once which one, naming them, and draft nothing until they answer. Then create the post with that account's socialConnectionId and projectId.`,
  );
}
