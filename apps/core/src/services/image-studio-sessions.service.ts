import { ProjectImageInitialTurn } from "@sokosumi/database";

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
 * How long an attempt that has actually dispatched may stay unaccounted for.
 *
 * Long enough to cover the agent's own send, including eve's readiness retry;
 * short enough that a deliverer which died mid-send does not lock the
 * conversation forever. An expired lease is *not* an invitation to send again —
 * the dead attempt may have been accepted — so it resolves to UNCERTAIN.
 *
 * Only DELIVERING waits this out. A claim nobody has acted on is takeable
 * immediately, because nothing has run and the previous holder may never even
 * have learned it held it.
 */
const INITIAL_TURN_LEASE_MS = 60_000;

/** What the agent is told, and the only thing it may act on. */
export interface InitialTurnState {
  initialTurn: ProjectImageInitialTurn;
  /** True only for the one caller that currently holds the delivery lease. */
  mayDeliver: boolean;
  /**
   * The lease this call was granted, if any. Presented again to announce the
   * dispatch and to report its outcome; an attempt whose lease has since been
   * taken over is refused, which is what stops two attempts delivering.
   */
  deliveryToken: string | null;
}

/**
 * Record a conversation the agent has just created, and say what is owed.
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
 * Two separate questions are answered here, and conflating them was the bug.
 *
 * *Which conversation is this?* — `clientIntentId`, the caller's own name for
 * the intent it is retrying. The row is found by that name, so a second
 * attempt at one intent lands on the conversation the first attempt created,
 * whatever happened to the first attempt's response. Without an intent there
 * is nothing to match on and every attempt is a new conversation, which is
 * what a create with no `operationId` means in eve's own contract.
 *
 * *Has its first message been delivered?* — {@link InitialTurnState}, never
 * "did this call insert the row". The row is written before the message is
 * dispatched, so its existence proved nothing; reading it as proof is what
 * silently dropped first messages. Exactly one caller is handed the right to
 * deliver, and it is handed that right here.
 *
 * @throws 409 if the id is already bound elsewhere — a second claim on a
 * conversation is never a legitimate creation.
 */
export async function registerCreatedSession(options: {
  projectId: string;
  userId: string;
  eveSessionId: string;
  title: string | null;
  /** The caller's stable name for this creation, across all of its retries. */
  clientIntentId?: string | null;
  /** Whether a first message is owed once the conversation is recorded. */
  expectsInitialTurn?: boolean;
}): Promise<SessionView & { wasCreated: boolean } & InitialTurnState> {
  const access = await requireProjectAccessForUser({
    projectId: options.projectId,
    userId: options.userId,
  });
  const clientIntentId = options.clientIntentId ?? null;

  const existing = await findRecordedSession({
    projectId: access.projectId,
    eveSessionId: options.eveSessionId,
    clientIntentId,
  });
  if (existing) {
    // Creation happens once. A repeat for the same project is the agent
    // retrying its own call, which is fine; anything else is a claim.
    if (existing.projectId !== access.projectId) {
      throw conflict("That conversation is already recorded elsewhere.");
    }
    return {
      ...(await touchSession(existing.id)),
      wasCreated: false,
      ...(await resolveInitialTurn(existing.id, options.expectsInitialTurn)),
    };
  }

  let created: SessionView;
  try {
    created = await prisma.projectImageSession.create({
      data: {
        projectId: access.projectId,
        workspaceId: access.workspaceId,
        createdByUserId: access.userId,
        eveSessionId: options.eveSessionId,
        title: options.title,
        clientIntentId,
        initialTurn: options.expectsInitialTurn
          ? ProjectImageInitialTurn.PENDING
          : ProjectImageInitialTurn.NONE,
      },
      select: sessionSelect,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Two retries of one intent raced, or the same eve session was recorded
    // twice. Either way the winner's row is the conversation; this caller
    // reads it and takes whatever is left to do, which is usually nothing.
    const winner = await findRecordedSession({
      projectId: access.projectId,
      eveSessionId: options.eveSessionId,
      clientIntentId,
    });
    if (!winner) throw error;
    if (winner.projectId !== access.projectId) {
      throw conflict("That conversation is already recorded elsewhere.");
    }
    return {
      ...(await touchSession(winner.id)),
      wasCreated: false,
      ...(await resolveInitialTurn(winner.id, options.expectsInitialTurn)),
    };
  }

  return {
    ...created,
    wasCreated: true,
    ...(await resolveInitialTurn(created.id, options.expectsInitialTurn)),
  };
}

/**
 * Take the delivery lease only when this call is the one carrying a message.
 *
 * A caller that is merely asking "which conversation is this intent?" — the
 * page recovering an attempt whose outcome it never saw — must not take a
 * lease it will not use, because holding one blocks the attempt that would.
 */
async function resolveInitialTurn(
  sessionId: string,
  expectsInitialTurn: boolean | undefined,
): Promise<InitialTurnState> {
  if (expectsInitialTurn) return await claimInitialTurn(sessionId);
  const current = await prisma.projectImageSession.findUnique({
    where: { id: sessionId },
    select: { initialTurn: true },
  });
  return {
    initialTurn: current?.initialTurn ?? ProjectImageInitialTurn.NONE,
    mayDeliver: false,
    deliveryToken: null,
  };
}

/**
 * The conversation this creation is about, by intent first and id second.
 *
 * Intent wins because it is the caller's own identity for the attempt: the
 * eve session id in hand may be a fresh one this retry just minted, which
 * names nothing. The id lookup stays for the cross-project claim check and for
 * callers that name no intent.
 */
async function findRecordedSession(options: {
  projectId: string;
  eveSessionId: string;
  clientIntentId: string | null;
}): Promise<(SessionView & { projectId: string }) | null> {
  if (options.clientIntentId) {
    const byIntent = await prisma.projectImageSession.findUnique({
      where: {
        projectId_clientIntentId: {
          projectId: options.projectId,
          clientIntentId: options.clientIntentId,
        },
      },
      select: { ...sessionSelect, projectId: true },
    });
    if (byIntent) return byIntent;
  }
  return await prisma.projectImageSession.findUnique({
    where: { eveSessionId: options.eveSessionId },
    select: { ...sessionSelect, projectId: true },
  });
}

/**
 * Hand exactly one caller the right to deliver the first message.
 *
 * `PENDING -> DELIVERING` is a single conditional update, so of two concurrent
 * retries of one intent only one is told `mayDeliver`. The other is told the
 * truth — a delivery is in flight — rather than being waved through on the
 * strength of the row existing, which is how the same text used to reach the
 * same conversation twice.
 *
 * A lease that has run out is *not* a second chance. The attempt holding it
 * never came back to say what happened, and "it probably did not get through"
 * is exactly the assumption that duplicates a turn. It resolves to UNCERTAIN,
 * which nothing redelivers automatically.
 */
async function claimInitialTurn(sessionId: string): Promise<InitialTurnState> {
  const now = new Date();
  const deliveryToken = crypto.randomUUID();

  // PENDING is owed to nobody; CLAIMED is owed to an attempt that has not acted
  // on it. Taking over the second is what rescues the case where the agent
  // committed a registration and then lost its response: that attempt will
  // never deliver and never report, and waiting out its lease would strand the
  // message in permanent uncertainty for something that never ran.
  const claimed = await prisma.projectImageSession.updateMany({
    where: {
      id: sessionId,
      initialTurn: {
        in: [ProjectImageInitialTurn.PENDING, ProjectImageInitialTurn.CLAIMED],
      },
    },
    data: {
      initialTurn: ProjectImageInitialTurn.CLAIMED,
      initialTurnLeaseAt: now,
      initialTurnLeaseOwner: deliveryToken,
    },
  });
  if (claimed.count === 1) {
    return {
      initialTurn: ProjectImageInitialTurn.CLAIMED,
      mayDeliver: true,
      deliveryToken,
    };
  }

  const abandoned = await prisma.projectImageSession.updateMany({
    where: {
      id: sessionId,
      initialTurn: ProjectImageInitialTurn.DELIVERING,
      initialTurnLeaseAt: {
        lt: new Date(now.getTime() - INITIAL_TURN_LEASE_MS),
      },
    },
    data: {
      initialTurn: ProjectImageInitialTurn.UNCERTAIN,
      initialTurnLeaseOwner: null,
    },
  });
  if (abandoned.count === 1) {
    return {
      initialTurn: ProjectImageInitialTurn.UNCERTAIN,
      mayDeliver: false,
      deliveryToken: null,
    };
  }

  const current = await prisma.projectImageSession.findUnique({
    where: { id: sessionId },
    select: { initialTurn: true },
  });
  return {
    initialTurn: current?.initialTurn ?? ProjectImageInitialTurn.NONE,
    mayDeliver: false,
    deliveryToken: null,
  };
}

/**
 * What a caller wants to do with the first message, or observed having done.
 *
 * `claim` asks for the right to deliver it, and is how *every* first-message
 * path — creation and an ordinary send into a conversation that still owes
 * one — enters the same decision. `dispatching` is announced before the send,
 * and it is what makes the difference between "nobody has tried" and "somebody
 * has": without it a crashed attempt is indistinguishable from one that never
 * started.
 */
export type InitialTurnTransition =
  | "claim"
  | "dispatching"
  | "delivered"
  | "undelivered"
  | "uncertain";

/** Which states each transition is allowed to move from, and to. */
const INITIAL_TURN_TRANSITIONS: Record<
  Exclude<InitialTurnTransition, "claim">,
  { from: ProjectImageInitialTurn[]; to: ProjectImageInitialTurn }
> = {
  dispatching: {
    from: [ProjectImageInitialTurn.CLAIMED],
    to: ProjectImageInitialTurn.DELIVERING,
  },
  delivered: {
    from: [
      ProjectImageInitialTurn.CLAIMED,
      ProjectImageInitialTurn.DELIVERING,
      ProjectImageInitialTurn.UNCERTAIN,
    ],
    to: ProjectImageInitialTurn.DELIVERED,
  },
  undelivered: {
    from: [ProjectImageInitialTurn.CLAIMED, ProjectImageInitialTurn.DELIVERING],
    to: ProjectImageInitialTurn.PENDING,
  },
  uncertain: {
    from: [ProjectImageInitialTurn.CLAIMED, ProjectImageInitialTurn.DELIVERING],
    to: ProjectImageInitialTurn.UNCERTAIN,
  },
};

/**
 * Move the first message's delivery, for whichever caller is holding it.
 *
 * One entry point for every path, because the first message is one thing
 * however it arrives. Creation reaches it through registration; an ordinary
 * send into a conversation whose first turn is still owed reaches it here with
 * `claim`. A send that skipped this was the hole: it delivered the message and
 * left the state saying nobody had, so a retry of the original creation could
 * dispatch the same text again.
 *
 * `dispatching` is fenced on the lease token and refuses without one. An
 * attempt whose lease was taken over while it was only claimed is refused
 * here, and must not send — that refusal is the whole reason two concurrent
 * attempts at one intent produce one delivery.
 *
 * `undelivered` is the outcome that makes a retry work: the runtime answered,
 * and its answer was a refusal, so nothing ran and the message is owed again.
 * `uncertain` is everything that could not be read that way — a thrown send, a
 * 5xx, a lost acknowledgement — and it deliberately leaves the conversation in
 * a state no automatic retry will dispatch into. It is closed by `delivered`
 * only when somebody has actually looked, which is why that transition accepts
 * a caller holding no lease.
 *
 * @throws 404 when the conversation is not this project's, or the caller's
 * access to it is gone.
 */
export async function transitionInitialTurn(options: {
  projectId: string;
  userId: string;
  eveSessionId: string;
  transition: InitialTurnTransition;
  deliveryToken?: string | null;
}): Promise<SessionView & InitialTurnState & { accepted: boolean }> {
  const session = await authorizeAgentSession({
    eveSessionId: options.eveSessionId,
    projectId: options.projectId,
    userId: options.userId,
  });

  if (options.transition === "claim") {
    const claimed = await claimInitialTurn(session.id);
    return { ...session, ...claimed, accepted: claimed.mayDeliver };
  }

  // A dispatch may only be announced by the attempt that holds the lease.
  // Everything else about this protocol rests on that, so an unfenced
  // announcement is refused rather than quietly allowed.
  if (options.transition === "dispatching" && !options.deliveryToken) {
    return {
      ...session,
      initialTurn: currentOrNone(await readInitialTurn(session.id)),
      mayDeliver: false,
      deliveryToken: null,
      accepted: false,
    };
  }

  const transition = INITIAL_TURN_TRANSITIONS[options.transition];
  const moved = await prisma.projectImageSession.updateMany({
    where: {
      id: session.id,
      initialTurn: { in: transition.from },
      ...(options.deliveryToken
        ? { initialTurnLeaseOwner: options.deliveryToken }
        : {}),
    },
    data: {
      initialTurn: transition.to,
      // A dispatch keeps its lease so a crashed attempt can still time out;
      // every other outcome is terminal for this attempt.
      ...(options.transition === "dispatching"
        ? { initialTurnLeaseAt: new Date() }
        : { initialTurnLeaseAt: null, initialTurnLeaseOwner: null }),
    },
  });

  return {
    ...session,
    initialTurn: currentOrNone(await readInitialTurn(session.id)),
    mayDeliver: false,
    deliveryToken: null,
    accepted: moved.count === 1,
  };
}

async function readInitialTurn(
  sessionId: string,
): Promise<ProjectImageInitialTurn | null> {
  const current = await prisma.projectImageSession.findUnique({
    where: { id: sessionId },
    select: { initialTurn: true },
  });
  return current?.initialTurn ?? null;
}

function currentOrNone(
  value: ProjectImageInitialTurn | null,
): ProjectImageInitialTurn {
  return value ?? ProjectImageInitialTurn.NONE;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
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
