import type { Prisma } from "@sokosumi/database";
import {
  type CreditBucketProjectOption,
  grantFreeCredits,
  grantSignupBonusCredits,
} from "@sokosumi/database/helpers";

import type { NetworkScope } from "@/lib/db/network-scope";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";

/**
 * What every grant takes, whatever its kind. A kind adds its own owner,
 * amount (in the unit its writer keeps), reference, activation and expiry,
 * and has its own receipt (`GrantResults`): a later kind is added beside
 * these, and these do not change for it.
 */
interface GrantCommon {
  /** The Network whose credits are given. */
  scope: NetworkScope;
  /**
   * The caller's open transaction: the grant, and the wake when there is
   * one, commit or roll back with the caller's own writes, at its isolation
   * level. A legacy transaction, as every grant opens it today.
   */
  tx: Prisma.TransactionClient;
  /**
   * Whether a grant that is new wakes the owner's Tasks that wait for
   * credits, right after it in the same transaction. A caller whose wake
   * comes later passes false and wakes itself: once for several grants (the
   * personal Workspace's free plan and bonus), or after a write of its own.
   */
  wakeTasks: boolean;
}

/**
 * A person's sign-up bonus: once per person, by a reference that is the
 * person's. A second grant finds the first and writes nothing.
 */
export interface SignupBonusGrant extends GrantCommon {
  kind: "signup_bonus";
  userId: string;
  /** Whole credits, above zero. */
  credits: number;
  /** Null never expires. */
  expiresAt: Date | null;
}

/**
 * Credits an admin, the CMO Tester grant or an eval lane gives: a fresh
 * reference per grant, from `grantId`, so the same grant given again grants
 * again. A caller that must not grant twice checks that before (the Tester
 * grant does). The database helper validates the owner and the Project as
 * given, and a Project id that is not one fails in the write, as before.
 */
export interface FreeGrant extends GrantCommon, CreditBucketProjectOption {
  kind: "free" | "cmo_tester";
  /**
   * A person's credits, stamped with the person, or an Organization's pool
   * (with `projectId`, that Project's credits, ADR 0067), stamped with no
   * member.
   */
  target:
    | { targetType: "user"; userId: string }
    | { targetType: "organization"; organizationId: string };
  /** Whole credits, above zero. */
  credits: number;
  /** Null never expires. */
  expiresAt: Date | null;
  grantId: string;
  /** Shown with the credits. */
  note: string | null;
}

export type GrantInput = SignupBonusGrant | FreeGrant;

/** A new grant, with its bucket. */
export interface Granted {
  outcome: "granted";
  bucketId: string;
}
/** The grant was given before: nothing was written. */
export interface AlreadyGranted {
  outcome: "already_granted";
  bucketId: string;
}

/** What each kind answers. */
interface GrantResults {
  signup_bonus: Granted | AlreadyGranted;
  free: Granted;
  cmo_tester: Granted;
}
export type GrantResult<Kind extends GrantInput["kind"] = GrantInput["kind"]> =
  GrantResults[Kind];

/**
 * Gives an owner credits: one positive transaction and its bucket, written by
 * the database helper of its kind. The module owns the rows and whether a
 * grant was already given; the caller owns who may grant, how much, the
 * transaction and its retries.
 */
export async function grant(
  input: SignupBonusGrant,
): Promise<GrantResult<"signup_bonus">>;
export async function grant(
  input: FreeGrant,
): Promise<GrantResult<"free" | "cmo_tester">>;
export async function grant(input: GrantInput): Promise<GrantResult> {
  const { scope, tx } = input;
  // A scope that refuses its Network throws here, before anything is written.
  scope.network;

  if (input.kind === "signup_bonus") {
    const { bucketId, created } = await grantSignupBonusCredits(
      {
        credits: input.credits,
        expiresAt: input.expiresAt,
        userId: input.userId,
      },
      tx,
    );
    if (!created) return { outcome: "already_granted", bucketId };
    if (input.wakeTasks) {
      await markOutOfCreditsTasksAsToppedUp({
        organizationId: null,
        tx,
        userId: input.userId,
      });
    }
    return { outcome: "granted", bucketId };
  }

  const { target } = input;
  const organizationId =
    target.targetType === "organization" ? target.organizationId : null;
  const userId = target.targetType === "user" ? target.userId : null;
  const { bucketId } = await grantFreeCredits(
    {
      credits: input.credits,
      expiresAt: input.expiresAt,
      grantId: input.grantId,
      organizationId,
      // As given: absent, null, or an id, for the helper to check and write.
      projectId: input.projectId,
      referenceNote: input.note,
      referenceType: input.kind === "free" ? "FREE" : "CMO_TESTER_CREDITS",
      targetId:
        target.targetType === "user" ? target.userId : target.organizationId,
      targetType: target.targetType,
      transactionUserId: userId,
    },
    tx,
  );
  if (input.wakeTasks) {
    await markOutOfCreditsTasksAsToppedUp({
      organizationId,
      projectId: input.projectId,
      tx,
      userId,
    });
  }
  return { outcome: "granted", bucketId };
}
