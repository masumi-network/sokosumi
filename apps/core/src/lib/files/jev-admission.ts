import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { fileActorFingerprint } from "@/lib/files/actor";
import { resolveScopeEpoch } from "@/lib/files/evidence-scope";

/**
 * One admission per outbound request, in every wave — not one per query.
 *
 * The contract is **authorized admission**, and it is deliberately weaker
 * than "no socket send after revocation commits". The linearization point is
 * the short transaction that writes the admission row after re-reading the
 * actor's current scope epoch. If revocation commits first, no admission is
 * granted and nothing is sent. If the admission commits first, that request
 * is in flight: its socket may open after revocation commits, and bytes
 * already transmitted cannot be recalled. Nothing here claims otherwise.
 *
 * The row records a digest of the serialized request, never the request.
 */

/** An admission that has not dispatched within this window must reauthorize. */
export const ADMISSION_VALID_MS = 50;

export interface AdmissionGrant {
  id: string;
  expiresAt: Date;
}

export async function admitJevRequest(input: {
  workspaceId: string;
  actor: FileActor;
  purpose: "search-rank" | "related-rank" | "label-suggest";
  payloadDigest: string;
  inputTokens: number;
  model: string;
  /** The epoch this request was prepared under; a change denies admission. */
  preparedEpoch: string;
  now?: Date;
}): Promise<AdmissionGrant | null> {
  const now = input.now ?? new Date();

  // Re-read the authorization clocks at the admission point rather than
  // trusting the value retrieval used a moment ago.
  const currentEpoch = await resolveScopeEpoch({
    workspaceId: input.workspaceId,
    actor: input.actor,
  });
  if (currentEpoch !== input.preparedEpoch) return null;

  const expiresAt = new Date(now.getTime() + ADMISSION_VALID_MS);

  const admission = await prisma.fileAuthorizationAdmission.create({
    data: {
      workspaceId: input.workspaceId,
      actorFingerprint: fileActorFingerprint(input.actor, input.workspaceId),
      epochVector: currentEpoch,
      purpose: input.purpose,
      payloadDigest: input.payloadDigest,
      provider: "vercel-ai-gateway",
      model: input.model,
      inputTokens: input.inputTokens,
      admittedAt: now,
      expiresAt,
    },
    select: { id: true, expiresAt: true },
  });

  return admission;
}

export async function recordJevDispatch(input: {
  admissionId: string;
  outcome: string;
  now?: Date;
}): Promise<void> {
  await prisma.fileAuthorizationAdmission.update({
    where: { id: input.admissionId },
    data: {
      dispatchedAt: input.now ?? new Date(),
      outcome: input.outcome,
    },
  });
}

/** True while the grant may still start a dispatch. */
export function isAdmissionDispatchable(
  grant: AdmissionGrant,
  now = new Date(),
): boolean {
  return grant.expiresAt.getTime() > now.getTime();
}
