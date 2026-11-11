import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";

import { writeOffUnlessLiveCuso } from "@/helpers/cuso-project-credits";

export interface CompensatingRefundInput {
  /** Positive cents. Callers already negated the debit. */
  amount: bigint;
  actorUserId: string;
  /** Null personal pot. Non-null org pot writes bucket.userId null. */
  organizationId: string | null;
  referenceId: string;
  /** The spend's consumptions, read with `COMPENSATED_SPEND_CONSUMPTIONS_SELECT`. */
  consumptions: readonly {
    amount: bigint;
    bucket: { projectId: string | null };
  }[];
}

/** Selects, on the spend transaction, what the refund needs to keep its scopes. */
export const COMPENSATED_SPEND_CONSUMPTIONS_SELECT = {
  creditConsumptions: {
    select: { amount: true, bucket: { select: { projectId: true } } },
  },
} satisfies Prisma.TransactionInclude;

/**
 * Creates the refund shared by job, claim, and x402 refunds, and returns the
 * id of the refund transaction the caller links to its record.
 *
 * Split by scope (ADR 0067): each Project's part goes back to that Project
 * and the rest to the pool, one refund transaction and bucket per scope,
 * since a bucket has one source transaction. The Project part comes first
 * and is the one linked: a charge draws its Project's credits first.
 * shortcut: only the linked part joins its record, so a split refund's pool part shows as an unlinked refund in history and Soko Bot usage; link both if splits become common.
 *
 * A Project part whose Project has no live Cuso is written off in the same
 * transaction, so the refund stays in history but an ordinary Project can't
 * spend it.
 *
 * Always unchecked scalars so org `userId: null` and personal `userId` share
 * one shape. Org refunds leave the ledger actor null; personal refunds stamp
 * the spend actor. The debit may have consumed expiring buckets, so refund
 * buckets do not expire.
 */
export async function createCompensatingRefund(
  tx: Prisma.TransactionClient,
  input: CompensatingRefundInput,
): Promise<string> {
  const projectParts = new Map<string, bigint>();
  for (const { amount, bucket } of input.consumptions) {
    if (bucket.projectId === null) continue;
    projectParts.set(
      bucket.projectId,
      (projectParts.get(bucket.projectId) ?? 0n) + amount,
    );
  }
  let poolPart = input.amount;
  for (const amount of projectParts.values()) poolPart -= amount;

  const parts: [string | null, bigint][] = [...projectParts];
  if (poolPart > 0n || parts.length === 0) parts.push([null, poolPart]);

  const isOrg = input.organizationId != null;
  const userId = isOrg ? null : input.actorUserId;
  const ids: string[] = [];
  for (const [projectId, amount] of parts) {
    const refund = await tx.transaction.create({
      data: {
        amount,
        organizationId: input.organizationId,
        userId,
        sourceCreditBucket: {
          create: {
            amount,
            referenceId: input.referenceId,
            referenceType: CreditBucketReferenceType.REFUND,
            expiresAt: null,
            userId,
            organizationId: input.organizationId,
            projectId,
          },
        },
      },
      select: { id: true },
    });
    ids.push(refund.id);
  }

  for (const projectId of projectParts.keys()) {
    await writeOffUnlessLiveCuso(projectId, tx);
  }

  return ids[0] as string;
}
