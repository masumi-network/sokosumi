import { notFound } from "@/helpers/error";
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

export async function bindSession(options: {
  projectId: string;
  workspaceId: string;
  userId: string;
  eveSessionId: string;
  title: string | null;
}): Promise<SessionView> {
  const access = await requireProjectAccess(options);

  const existing = await prisma.projectImageSession.findUnique({
    where: { eveSessionId: options.eveSessionId },
    select: { ...sessionSelect, projectId: true },
  });
  if (existing) {
    // The unique index already guarantees one project per eve session; this
    // turns the resulting constraint error into the honest answer.
    if (existing.projectId !== options.projectId) {
      throw notFound("Conversation not found");
    }
    return await touchSession(existing.id);
  }

  return await prisma.projectImageSession.create({
    data: {
      projectId: access.projectId,
      workspaceId: access.workspaceId,
      createdByUserId: access.userId,
      eveSessionId: options.eveSessionId,
      title: options.title,
    },
    select: sessionSelect,
  });
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
