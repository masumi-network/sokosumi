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
 * Authorize one operation on an eve session, and bind it on first contact.
 *
 * This is the check that stands between a studio token and somebody else's
 * conversation. The token proves who the caller is and which project they are
 * working in; it says nothing about the session id in the URL. Without this,
 * a token minted for project A opened project B's transcript, replayed it,
 * cleared it, and sent to it.
 *
 * Two cases:
 *
 * - The session is already bound. It must be bound to *this* project, and the
 *   caller must still have access to that project right now. A membership
 *   revoked after the token was minted fails here, because the check re-reads
 *   the database rather than trusting the token.
 * - The session has never been seen. The caller claims it. This is safe
 *   because an eve session id is only ever returned to the caller that created
 *   it, and the agent binds on `session.started`, so an id is bound before
 *   anyone else could learn it. The unique index settles any race.
 *
 * @throws 404 for a session belonging to another project, or for a caller who
 * no longer has access. Never 403: whether a session exists is itself
 * information the caller has not earned.
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

  if (existing) {
    if (existing.projectId !== access.projectId) {
      throw notFound("Conversation not found");
    }
    return await touchSession(existing.id);
  }

  try {
    return await prisma.projectImageSession.create({
      data: {
        projectId: access.projectId,
        workspaceId: access.workspaceId,
        createdByUserId: access.userId,
        eveSessionId: options.eveSessionId,
        title: null,
      },
      select: sessionSelect,
    });
  } catch (error) {
    // Lost the race to bind. Re-read and apply the same rule to the winner.
    if (isUniqueViolation(error)) {
      const winner = await prisma.projectImageSession.findUnique({
        where: { eveSessionId: options.eveSessionId },
        select: { ...sessionSelect, projectId: true },
      });
      if (!winner || winner.projectId !== access.projectId) {
        throw notFound("Conversation not found");
      }
      return await touchSession(winner.id);
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
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
