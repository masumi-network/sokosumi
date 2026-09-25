import { conflict, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  requireProjectAccess,
  requireProjectAccessForUser,
} from "@/lib/image-studio/access";

/**
 * The binding between an eve conversation and a project.
 *
 * eve owns the transcript and replays it; this row is what makes that
 * transcript project-scoped. Resuming requires finding the session here first,
 * so knowing an eve session id is never enough to reach a conversation — the
 * caller must also currently have access to the project it is bound to.
 */

export interface SessionView {
  id: string;
  eveSessionId: string;
  title: string | null;
  createdByUserId: string;
  lastActivityAt: Date;
  createdAt: Date;
}

const sessionSelect = {
  id: true,
  eveSessionId: true,
  title: true,
  createdByUserId: true,
  lastActivityAt: true,
  createdAt: true,
} as const;

/**
 * Record a conversation the agent has just created, against its project.
 *
 * Reachable only through Core's agent surface, which accepts only grants of
 * the `agent` audience — so the only caller that can reach this is the agent
 * itself, in the request that created the session. That is what makes the
 * binding a statement about *who created the conversation* rather than about
 * who knows its id.
 *
 * The previous arrangement let the browser bind any id it named. Possession of
 * an unbound id was therefore treated as ownership, so a leaked id from an
 * older conversation could be attached to the attacker's own project and read.
 *
 * Reports whether this call created the record. A repeat for the same project
 * is the agent retrying an `operationId` creation onto a conversation it
 * already owns, whose first message has already been delivered.
 *
 * @throws 409 if the id is already bound elsewhere — a second claim on a
 * conversation is never a legitimate creation.
 */
export async function registerCreatedSession(options: {
  projectId: string;
  userId: string;
  eveSessionId: string;
  title: string | null;
}): Promise<SessionView & { wasCreated: boolean }> {
  const access = await requireProjectAccessForUser({
    projectId: options.projectId,
    userId: options.userId,
  });

  const existing = await prisma.projectImageSession.findUnique({
    where: { eveSessionId: options.eveSessionId },
    select: { ...sessionSelect, projectId: true },
  });
  if (existing) {
    // Creation happens once. A repeat for the same project is the agent
    // retrying its own call, which is fine; anything else is a claim.
    if (existing.projectId !== access.projectId) {
      throw conflict("That conversation is already recorded elsewhere.");
    }
    // Not created by this call. The agent uses that to tell an `operationId`
    // retry from a first creation, so it does not deliver the conversation's
    // first message a second time.
    return { ...(await touchSession(existing.id)), wasCreated: false };
  }

  const session = await prisma.projectImageSession.create({
    data: {
      projectId: access.projectId,
      workspaceId: access.workspaceId,
      createdByUserId: access.userId,
      eveSessionId: options.eveSessionId,
      title: options.title,
    },
    select: sessionSelect,
  });
  return { ...session, wasCreated: true };
}

export async function touchSession(sessionId: string): Promise<SessionView> {
  return await prisma.projectImageSession.update({
    where: { id: sessionId },
    data: { lastActivityAt: new Date() },
    select: sessionSelect,
  });
}

export async function listSessions(options: {
  projectId: string;
  workspaceId: string;
  userId: string;
  limit: number;
}): Promise<SessionView[]> {
  await requireProjectAccess(options);
  return await prisma.projectImageSession.findMany({
    where: { projectId: options.projectId },
    orderBy: { lastActivityAt: "desc" },
    take: options.limit,
    select: sessionSelect,
  });
}

/**
 * Authorize one operation on an eve session against its binding.
 *
 * This is the check that stands between a studio token and somebody else's
 * conversation. The token proves who the caller is and which project they are
 * working in; it says nothing about the session id in the URL.
 *
 * It refuses an unbound session outright. An earlier version claimed one for
 * whichever project asked first, which meant a conversation created before
 * this code existed — or one whose binding failed — belonged to whoever
 * guessed its id. Ownership is established once, by the signed-in user through
 * `bindSession`, before the conversation carries anything; everything after
 * that only ever checks.
 *
 * @throws 404 for an unbound session, a session belonging to another project,
 * or a caller who no longer has access. Never 403: whether a conversation
 * exists is itself information the caller has not earned.
 */
export async function authorizeAgentSession(options: {
  eveSessionId: string;
  projectId: string;
  userId: string;
}): Promise<SessionView> {
  const access = await requireProjectAccessForUser({
    projectId: options.projectId,
    userId: options.userId,
  });

  const existing = await prisma.projectImageSession.findUnique({
    where: { eveSessionId: options.eveSessionId },
    select: { ...sessionSelect, projectId: true },
  });

  if (!existing || existing.projectId !== access.projectId) {
    throw notFound("Conversation not found");
  }

  return await touchSession(existing.id);
}

/**
 * Re-authorize a resume.
 *
 * Called on every reattachment, not only when the session is created: a user
 * whose membership was revoked between the first message and the reload must
 * not get the transcript back.
 */
export async function resolveSessionForResume(options: {
  eveSessionId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
}): Promise<SessionView> {
  await requireProjectAccess(options);
  const session = await prisma.projectImageSession.findFirst({
    where: {
      eveSessionId: options.eveSessionId,
      projectId: options.projectId,
    },
    select: sessionSelect,
  });
  if (!session) throw notFound("Conversation not found");
  return session;
}
