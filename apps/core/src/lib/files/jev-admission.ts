import { PrismaRaw } from "@sokosumi/database/client";

import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { fileActorFingerprint } from "@/lib/files/actor";
import { resolveScopeEpoch } from "@/lib/files/evidence-scope";
import {
  GLOBAL_INPUT_TOKENS_PER_MINUTE,
  GLOBAL_REQUESTS_PER_MINUTE,
  PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE,
} from "@/lib/files/jev-scheduler";

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

/**
 * The window the shared ceiling counts over. One minute, matching the
 * per-minute constants it enforces.
 */
const SHARED_WINDOW_MS = 60_000;

export type AdmissionDenial =
  | "epoch-changed"
  | "shared-global-rate"
  | "shared-global-token-budget"
  | "shared-workspace-token-budget";

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
  const windowStart = new Date(now.getTime() - SHARED_WINDOW_MS);

  /**
   * The ceiling that actually holds across runtimes.
   *
   * `jev-scheduler` counts in memory, so on a platform that runs many
   * instances its per-minute numbers were a per-process share wearing a
   * global name: ten instances meant ten times the stated rate. This counts
   * the admissions themselves, which are rows, so every runtime sees the
   * same total.
   *
   * It costs no extra round trip — the count runs inside the transaction
   * that was already writing the admission row — and `SERIALIZABLE` is what
   * makes two instances admitting at once resolve to one winner rather than
   * both reading the same pre-count.
   */
  try {
    return await prisma.$transaction<AdmissionGrant | null>(
      async (tx) => {
        const [usage] = await tx.$queryRaw<
          { requests: bigint; globalTokens: bigint; workspaceTokens: bigint }[]
        >(PrismaRaw.sql`
          SELECT
            count(*) AS "requests",
            coalesce(sum("inputTokens"), 0) AS "globalTokens",
            coalesce(sum("inputTokens") FILTER (
              WHERE "workspaceId" = ${input.workspaceId}::uuid
            ), 0) AS "workspaceTokens"
          FROM file_authorization_admission
          WHERE "admittedAt" > ${windowStart}
        `);

        const requests = Number(usage?.requests ?? 0);
        const globalTokens = Number(usage?.globalTokens ?? 0);
        const workspaceTokens = Number(usage?.workspaceTokens ?? 0);

        if (requests + 1 > GLOBAL_REQUESTS_PER_MINUTE) return null;
        if (globalTokens + input.inputTokens > GLOBAL_INPUT_TOKENS_PER_MINUTE) {
          return null;
        }
        if (
          workspaceTokens + input.inputTokens >
          PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE
        ) {
          return null;
        }

        return await tx.fileAuthorizationAdmission.create({
          data: {
            workspaceId: input.workspaceId,
            actorFingerprint: fileActorFingerprint(
              input.actor,
              input.workspaceId,
            ),
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
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    // A serialization failure means another runtime won the same slot.
    // Refusing is the safe answer: the caller falls back to the
    // deterministic order, which is what a quota denial already does.
    return null;
  }
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
