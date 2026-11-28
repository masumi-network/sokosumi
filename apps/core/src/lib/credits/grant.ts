import type { Prisma } from "@sokosumi/database";
import {
  grantFreeCredits,
  grantSignupBonusCredits,
} from "@sokosumi/database/helpers";

import type { NetworkScope } from "@/lib/db/network-scope";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";

/** A person's personal credits. */
export interface PersonalOwner {
  userId: string;
  organizationId: null;
  projectId: null;
}

/** Whose credits a grant gives. */
export type CreditOwner =
  | PersonalOwner
  /**
   * An Organization's: its pool, or with a Project that Project's credits
   * (ADR 0067). The grant names no member.
   */
  | { userId: null; organizationId: string; projectId: string | null };

/**
 * What a grant is, which decides its reference and so whether it can be
 * given twice:
 * - `signup_bonus`: a person's, once: its reference is the person's.
 * - `free` and `cmo_tester`: a fresh reference per grant, from `grantId`, so
 *   the same request given again grants again. The caller that must not
 *   grant twice checks that itself before (the Tester grant does).
 */
export type GrantKind =
  | { kind: "signup_bonus"; owner: PersonalOwner }
  | {
      kind: "free" | "cmo_tester";
      owner: CreditOwner;
      grantId: string;
      /** Shown with the credits. */
      note: string | null;
    };

export type GrantInput = GrantKind & {
  /** The Network whose credits are given. */
  scope: NetworkScope;
  /**
   * The caller's open transaction: the grant, and the wake when there is
   * one, commit or roll back with the caller's own writes, at its isolation
   * level. A legacy transaction, as every grant opens it today.
   */
  tx: Prisma.TransactionClient;
  /** Whole credits, above zero. */
  credits: number;
  /** Null never expires. */
  expiresAt: Date | null;
  /**
   * Whether a grant that is new wakes the owner's Tasks that wait for
   * credits, right after it in the same transaction. A caller that grants
   * more than this one and wakes once for all of them passes false and wakes
   * itself (personal Workspace initialization, with its free plan).
   */
  wakeTasks: boolean;
};

/** The grant was given now, or it was given before and nothing was written. */
export type GrantResult =
  | { outcome: "granted"; bucketId: string }
  | { outcome: "already_granted"; bucketId: string };

/**
 * Gives an owner credits: one positive transaction and its bucket. The module
 * owns the rows and whether a grant was already given; the caller owns who
 * may grant, how much, the transaction and its retries.
 */
export async function grant(input: GrantInput): Promise<GrantResult> {
  const { scope, tx, owner, credits, expiresAt } = input;
  // A scope that refuses its Network throws here, before anything is written.
  scope.network;

  let result: GrantResult;
  if (input.kind === "signup_bonus") {
    const { bucketId, created } = await grantSignupBonusCredits(
      { credits, expiresAt, userId: input.owner.userId },
      tx,
    );
    result = { outcome: created ? "granted" : "already_granted", bucketId };
  } else {
    const { bucketId } = await grantFreeCredits(
      {
        credits,
        expiresAt,
        grantId: input.grantId,
        organizationId: owner.organizationId,
        // Absent, not null, for an Organization's pool: the bucket's insert
        // then leaves the column out, as it always did.
        projectId: owner.projectId ?? undefined,
        referenceNote: input.note,
        referenceType: input.kind === "free" ? "FREE" : "CMO_TESTER_CREDITS",
        ...(owner.organizationId === null
          ? { targetId: owner.userId, targetType: "user" as const }
          : {
              targetId: owner.organizationId,
              targetType: "organization" as const,
            }),
        transactionUserId: owner.userId,
      },
      tx,
    );
    result = { outcome: "granted", bucketId };
  }

  if (input.wakeTasks && result.outcome === "granted") {
    await markOutOfCreditsTasksAsToppedUp({
      organizationId: owner.organizationId,
      projectId: owner.projectId ?? undefined,
      tx,
      userId: owner.userId,
    });
  }
  return result;
}
