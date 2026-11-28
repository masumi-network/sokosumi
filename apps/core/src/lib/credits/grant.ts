import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import {
  type CreditBucketProjectOption,
  createEnterprisePeriodCreditBucket,
  createEnterpriseTopUpCreditBucket,
  expireCreditBucketsNow,
  type GrantEnterpriseCredits,
  type GrantLocalFreePeriodCredits,
  grantFreeCredits,
  grantLocalFreePeriodCredits,
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
 * The amount, in the unit the kind's writer keeps: whole credits, or cents
 * (10^10 per credit) where the writer is handed cents. Never both.
 */
type InCredits = {
  /** Whole credits, above zero. */
  credits: number;
  cents?: never;
};
type InCents = {
  /** Cents, above zero. */
  cents: bigint;
  credits?: never;
};

/** A person's credits, or an Organization's pool with no member. */
type PersonOrPool =
  | { userId: string; organizationId?: never }
  | { organizationId: string; userId?: never };

/**
 * A person's sign-up bonus: once per person, by a reference that is the
 * person's. A second grant finds the first and writes nothing.
 */
export interface SignupBonusGrant extends GrantCommon, InCredits {
  kind: "signup_bonus";
  userId: string;
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
export interface FreeGrant
  extends GrantCommon,
    CreditBucketProjectOption,
    InCredits {
  kind: "free" | "cmo_tester";
  /**
   * A person's credits, stamped with the person, or an Organization's pool
   * (with `projectId`, that Project's credits, ADR 0067), stamped with no
   * member.
   */
  target:
    | { targetType: "user"; userId: string }
    | { targetType: "organization"; organizationId: string };
  /** Null never expires. */
  expiresAt: Date | null;
  grantId: string;
  /** Shown with the credits. */
  note: string | null;
}

/**
 * A local free plan's period: once per owner and period,
 * by a reference composed of the owner and `periodEnd`. The credits expire
 * at the period's end; a period that starts later activates then.
 */
export interface LocalFreePeriodGrant extends GrantCommon, InCredits {
  kind: "local_free_period";
  owner: PersonOrPool;
  periodEnd: Date;
  /** Null is active now. */
  activatesAt: Date | null;
}

/**
 * An enterprise contract's period or top-up: once per period or contract id.
 * A period always expires; a top-up may not.
 */
export type EnterpriseGrant = GrantCommon &
  InCents & { organizationId: string; activatesAt: Date } & (
    | { kind: "enterprise_period"; periodId: string; expiresAt: Date }
    | {
        kind: "enterprise_top_up";
        contractId: string;
        /** Null never expires. */
        expiresAt: Date | null;
      }
  );

/*
 * The kinds the later pull requests of the credits cut bring, as their
 * writers on `origin/main` take them. Their callers are not moved yet, so
 * `grant` does not take them: each is added to `BuiltGrant` by the pull
 * request that moves its writer, with its dispatch.
 */

/**
 * A CMO payment's credits for a Cuso's Project (pull request 12), keyed by
 * `<orderId>:<monthIndex>`. A grant given before fails on that key, which
 * rolls back the caller's whole transaction: the caller answers it outside,
 * so no receipt here says "already granted". The caller fences before and
 * writes its own row after, then wakes (`wakeTasks: false`).
 */
export interface PolarGrant extends GrantCommon, InCents {
  kind: "polar";
  organizationId: string;
  projectId: string;
  referenceId: string;
  referenceType: CreditBucketReferenceType;
  note: string;
  expiresAt: Date;
}

/**
 * One entry of a paid Stripe invoice (pull request 13): once per owner,
 * invoice and entry kind, by a reference composed of them. The caller wakes
 * once after every entry (`wakeTasks: false`), from the entries newly given.
 */
export interface StripeInvoiceGrant extends GrantCommon, InCents {
  kind: "stripe_invoice";
  owner: PersonOrPool;
  invoiceId: string;
  entry: "subscription" | "topup";
  referenceType: CreditBucketReferenceType;
  /** Null never expires. */
  expiresAt: Date | null;
}

/** Every kind of grant, the ones `grant` takes now and the later ones. */
export type GrantRequest =
  | SignupBonusGrant
  | FreeGrant
  | LocalFreePeriodGrant
  | EnterpriseGrant
  | PolarGrant
  | StripeInvoiceGrant;

/** The kinds `grant` takes now. */
export type BuiltGrant =
  | SignupBonusGrant
  | FreeGrant
  | LocalFreePeriodGrant
  | EnterpriseGrant;

/** A new grant, with its bucket. */
export interface Granted {
  outcome: "granted";
  bucketId: string;
}
/** A grant of the same reference was there: nothing was written. */
export interface AlreadyGranted {
  outcome: "already_granted";
  bucketId: string;
}
/** A new grant whose writer does not read its bucket back. */
export interface GrantedWithoutBucket {
  outcome: "granted";
  bucketId: null;
}
/** A grant of the same reference was there, its bucket not read. */
export interface AlreadyGrantedWithoutBucket {
  outcome: "already_granted";
  bucketId: null;
}

/** What each kind answers. */
interface GrantResults {
  signup_bonus: Granted | AlreadyGranted;
  free: Granted;
  cmo_tester: Granted;
  local_free_period: GrantedWithoutBucket | AlreadyGrantedWithoutBucket;
  enterprise_period: Granted | AlreadyGranted;
  enterprise_top_up: Granted | AlreadyGranted;
  polar: GrantedWithoutBucket;
  stripe_invoice: GrantedWithoutBucket | AlreadyGrantedWithoutBucket;
}
export type GrantResult<
  Kind extends GrantRequest["kind"] = BuiltGrant["kind"],
> = GrantResults[Kind];

/**
 * Gives an owner credits: one positive transaction and its bucket, written by
 * the database helper of its kind. The module owns the rows and whether a
 * grant was already given; the caller owns who may grant, how much, the
 * transaction and its retries.
 */
export async function grant<Input extends BuiltGrant>(
  input: Input,
): Promise<GrantResult<Input["kind"]>>;
export async function grant(
  input: BuiltGrant,
): Promise<GrantResult<BuiltGrant["kind"]>> {
  const { scope, tx } = input;
  // A scope that refuses its Network throws here, before anything is written.
  scope.network;

  if (input.kind === "local_free_period") {
    const { owner } = input;
    const { created } = await grantLocalFreePeriodCredits(
      {
        owner,
        credits: input.credits,
        periodEnd: input.periodEnd,
        activatesAt: input.activatesAt,
      },
      tx,
    );
    if (!created) return { outcome: "already_granted", bucketId: null };
    if (input.wakeTasks) {
      await markOutOfCreditsTasksAsToppedUp({
        organizationId: owner.organizationId ?? null,
        tx,
        userId: owner.userId ?? null,
      });
    }
    return { outcome: "granted", bucketId: null };
  }

  if (
    input.kind === "enterprise_period" ||
    input.kind === "enterprise_top_up"
  ) {
    const written = {
      activatesAt: input.activatesAt,
      amount: input.cents,
      organizationId: input.organizationId,
    };
    const { bucketId, created } =
      input.kind === "enterprise_period"
        ? await createEnterprisePeriodCreditBucket(
            {
              ...written,
              expiresAt: input.expiresAt,
              periodId: input.periodId,
            },
            tx,
          )
        : await createEnterpriseTopUpCreditBucket(
            {
              ...written,
              contractId: input.contractId,
              expiresAt: input.expiresAt,
            },
            tx,
          );
    if (!created) return { outcome: "already_granted", bucketId };
    if (input.wakeTasks) {
      await markOutOfCreditsTasksAsToppedUp({
        organizationId: input.organizationId,
        tx,
        userId: null,
      });
    }
    return { outcome: "granted", bucketId };
  }

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

/**
 * `grant` as the local free plan's database helpers take it: each period
 * they open is given on the caller's transaction, and wakes nothing (the
 * personal Workspace wakes once for its free plan and its bonus).
 */
export function grantLocalFreePeriods(
  scope: NetworkScope,
  tx: Prisma.TransactionClient,
): GrantLocalFreePeriodCredits {
  return (credits) =>
    grant({
      ...credits,
      scope,
      tx,
      kind: "local_free_period",
      wakeTasks: false,
    });
}

/**
 * `grant` as the enterprise contract helpers take it, on the caller's
 * transaction. An enterprise grant wakes no Task.
 */
export function grantEnterpriseCredits(
  scope: NetworkScope,
  tx: Prisma.TransactionClient,
): GrantEnterpriseCredits {
  return (credits) => grant({ ...credits, scope, tx, wakeTasks: false });
}

/**
 * Ends an enterprise contract's credits now: every bucket of its periods,
 * and of its top-up when it has one, that would still be live at `now`
 * expires at `now`, in the caller's transaction. Answers how many expired.
 * A write on buckets that are there, not a grant: it gives nothing back.
 */
export async function expireEnterpriseGrants(input: {
  scope: NetworkScope;
  tx: Prisma.TransactionClient;
  periodIds: string[];
  /** The contract's id when it has a top-up, else null. */
  topUpContractId: string | null;
  now: Date;
}): Promise<number> {
  // A scope that refuses its Network throws here, before anything is written.
  input.scope.network;
  return await expireCreditBucketsNow(
    {
      now: input.now,
      referenceIds:
        input.topUpContractId === null
          ? input.periodIds
          : [...input.periodIds, input.topUpContractId],
      referenceTypes: [
        CreditBucketReferenceType.ENTERPRISE_PERIOD,
        CreditBucketReferenceType.ENTERPRISE_TOP_UP,
      ],
    },
    input.tx,
  );
}
