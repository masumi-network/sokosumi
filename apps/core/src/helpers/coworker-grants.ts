import {
  CoworkerGrantScope,
  CoworkerGrantStatus,
  NotificationKind,
  type Prisma,
} from "@sokosumi/database";

import { forbidden } from "@/helpers/error";
import { createNotification } from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";

/**
 * Reserved slug of the Hermes coordinator coworker. Already de-facto
 * reserved: the web hides it from coworker pickers and the orchestrator
 * refuses to assign tasks to it.
 */
export const HERMES_COWORKER_SLUG = "hermes";

/**
 * Stable machine-readable error kind for "the coworker lacks a grant".
 * Delegated callers (the Hermes orchestrator) match on this to tell the
 * user an approval is waiting, instead of surfacing a generic 403.
 */
export const GRANT_REQUIRED_ERROR_KIND = "grant_required";

export const COWORKER_GRANT_SCOPES = [
  CoworkerGrantScope.TASK_READ,
  CoworkerGrantScope.TASK_COMMENT,
  CoworkerGrantScope.TASK_CREATE,
] as const;

/** True when the user has an active grant for this coworker + scope. */
export async function hasCoworkerGrant(
  coworkerId: string,
  userId: string,
  scope: CoworkerGrantScope,
  tx: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const grant = await tx.coworkerGrant.findUnique({
    where: {
      coworkerId_userId_scope: { coworkerId, userId, scope },
    },
    select: { status: true },
  });
  return grant?.status === CoworkerGrantStatus.GRANTED;
}

/**
 * Records that a coworker asked for access it does not have: ensures a
 * PENDING grant row exists (never downgrades an existing resolution — a
 * DENIED/REVOKED grant stays resolved until the user changes it in the
 * portal) and emits an idempotent notification to the user. Returns the
 * pending grant id, or null when the user already denied/revoked (no new
 * request is surfaced).
 *
 * Deliberately uses the GLOBAL prisma client: callers throw right after
 * this from inside serializable transactions, and the request + its
 * notification must survive that rollback.
 */
export async function requestCoworkerGrant(
  coworkerId: string,
  userId: string,
  scope: CoworkerGrantScope,
): Promise<string | null> {
  const existing = await prisma.coworkerGrant.findUnique({
    where: { coworkerId_userId_scope: { coworkerId, userId, scope } },
    select: { id: true, status: true },
  });

  let grantId: string;
  if (existing) {
    // Leave PENDING as-is; leave DENIED/REVOKED resolved (anti-nag: the
    // user said no — the coworker retrying must not resurface the request).
    grantId = existing.id;
    if (existing.status !== CoworkerGrantStatus.PENDING) return null;
  } else {
    const created = await prisma.coworkerGrant.create({
      data: { coworkerId, userId, scope },
      select: { id: true },
    });
    grantId = created.id;
  }

  const coworker = await prisma.coworker.findUnique({
    where: { id: coworkerId },
    select: { name: true, slug: true, image: true },
  });

  // Idempotent on (userId, kind, referenceId, eventId, messageKey) — a
  // coworker retrying the same blocked call never spams the feed.
  // coworkerImage/coworkerSlug are not referenced by the message — they let
  // notification UIs show the requesting coworker's avatar.
  await createNotification({
    userId,
    kind: NotificationKind.COWORKER_ACCESS,
    referenceId: grantId,
    eventId: grantId,
    messageKey: "Notifications.CoworkerAccess.requested",
    messageParams: {
      coworkerName: coworker?.name ?? "A coworker",
      scope,
      ...(coworker?.image ? { coworkerImage: coworker.image } : {}),
      ...(coworker?.slug ? { coworkerSlug: coworker.slug } : {}),
    },
    metadata: { coworkerId, scope },
  });

  return grantId;
}

/**
 * Gate for delegated-coworker access beyond the SOK-554 assignment
 * baseline. Passes silently when the user granted this scope; otherwise
 * records a pending request + notification (outside the caller's
 * transaction) and throws 403 with kind `grant_required`.
 */
export async function requireCoworkerGrant(
  coworkerId: string,
  userId: string,
  scope: CoworkerGrantScope,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  if (await hasCoworkerGrant(coworkerId, userId, scope, tx)) return;

  await requestCoworkerGrant(coworkerId, userId, scope);

  throw forbidden(
    "This coworker needs your approval for this action. Review the request under Connections → Coworker access.",
    {
      kind: GRANT_REQUIRED_ERROR_KIND,
      extensions: { scope },
    },
  );
}

/**
 * Auto-grants the Hermes coordinator for a user — called from Hermes
 * instance provisioning so the user's own assistant works out of the box.
 * Create-if-missing only: a grant the user explicitly revoked or denied is
 * never silently re-granted by re-provisioning.
 */
export async function ensureHermesCoworkerGrants(
  userId: string,
): Promise<void> {
  const hermes = await prisma.coworker.findFirst({
    where: { slug: HERMES_COWORKER_SLUG, archivedAt: null },
    select: { id: true },
  });
  if (!hermes) return;

  await prisma.coworkerGrant.createMany({
    data: COWORKER_GRANT_SCOPES.map((scope) => ({
      coworkerId: hermes.id,
      userId,
      scope,
      status: CoworkerGrantStatus.GRANTED,
      resolvedAt: new Date(),
    })),
    skipDuplicates: true,
  });
}
