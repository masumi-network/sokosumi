import { err, ok, type Result } from "neverthrow";

import {
  CreditBucketReferenceType,
  Prisma,
  type PrismaClient,
} from "../generated/prisma/client.js";
import {
  buildOrganizationInvoiceCreditReferenceId,
  ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
} from "./credit.js";
import {
  buildLocalFreeOrganizationSubscriptionReferenceId,
  LOCAL_FREE_SUBSCRIPTION_REFERENCE_CONTAINS,
} from "./subscription.js";

export const SENTINEL_FACE_CENTS = 1n;
export const SENTINEL_REFERENCE_NOTE = "SOK-905 idempotency sentinel";

export type SentinelKind = "invoice_subscription" | "local_free_subscription";

export type OrgPeriodIdempotencyReferenceId = string;

export interface OrgPeriodSentinelSpec {
  actorUserId: string;
  activatesAt: Date | null;
  expiresAt: Date | null;
  kind: SentinelKind;
  organizationId: string;
  referenceId: OrgPeriodIdempotencyReferenceId;
  sourceBucketId: string;
}

export interface SentinelBackfillResult {
  alreadyPresent: number;
  created: number;
  distinctFingerprints: number;
  scannedLeftovers: number;
  skippedNoActor: number;
  unparseable: number;
}

export interface TombstoneDeleteResult {
  candidates: number;
  deleted: number;
  skippedRemainingPositive: number;
  skippedUncovered: number;
  skippedUnparseable: number;
}

export interface SentinelCoverageFailure {
  uncoveredReferenceIds: string[];
  unparseable: number;
}

export type SentinelDebugLog = (message: string) => void;

interface SentinelOperationParams {
  debug?: SentinelDebugLog;
  dryRun?: boolean;
  organizationId?: string;
}

interface LeftoverMemberPeriodRow {
  activatesAt: Date | null;
  expiresAt: Date | null;
  id: string;
  organizationId: string;
  referenceId: string;
  remaining: bigint;
  userId: string;
}

interface ParsedMemberPeriodLeftover {
  fingerprint: string;
  kind: SentinelKind;
  orgReferenceId: OrgPeriodIdempotencyReferenceId;
}

const MEMBER_LOCAL_FREE_REF = /^member:[^:]+:local-free:([^:]+):(.+)$/;
const MEMBER_INVOICE_SUBSCRIPTION_REF = /^member:[^:]+:([^:]+):subscription$/;

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function sentinelExpiresAt(expiresAt: Date | null): Date {
  return expiresAt ?? new Date(0);
}

export function parseMemberPeriodReferenceId(
  referenceId: string,
  organizationId: string,
): Result<ParsedMemberPeriodLeftover, "unparseable"> {
  if (
    !referenceId.startsWith(ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX)
  ) {
    return err("unparseable");
  }

  if (referenceId.includes(LOCAL_FREE_SUBSCRIPTION_REFERENCE_CONTAINS)) {
    const match = MEMBER_LOCAL_FREE_REF.exec(referenceId);
    if (!match) {
      return err("unparseable");
    }
    const [, refOrganizationId, periodEndIso] = match;
    if (!refOrganizationId || !periodEndIso) {
      return err("unparseable");
    }
    if (refOrganizationId !== organizationId) {
      return err("unparseable");
    }
    const periodEnd = new Date(periodEndIso);
    if (
      Number.isNaN(periodEnd.getTime()) ||
      periodEnd.toISOString() !== periodEndIso
    ) {
      return err("unparseable");
    }
    return ok({
      fingerprint: periodEndIso,
      kind: "local_free_subscription",
      orgReferenceId: buildLocalFreeOrganizationSubscriptionReferenceId(
        organizationId,
        periodEnd,
      ),
    });
  }

  const invoiceMatch = MEMBER_INVOICE_SUBSCRIPTION_REF.exec(referenceId);
  if (!invoiceMatch) {
    return err("unparseable");
  }
  const [, invoiceId] = invoiceMatch;
  if (!invoiceId || invoiceId === "local-free") {
    return err("unparseable");
  }

  return ok({
    fingerprint: invoiceId,
    kind: "invoice_subscription",
    orgReferenceId: buildOrganizationInvoiceCreditReferenceId(
      organizationId,
      invoiceId,
      "subscription",
    ),
  });
}

const leftoverMemberPeriodWhereSql = Prisma.sql`
  cb."referenceType" = ${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}
  AND cb."referenceId" LIKE ${`${ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX}%`}
  AND cb."userId" IS NOT NULL
`;

async function listLeftoverMemberPeriodRows(
  prisma: PrismaClient | Prisma.TransactionClient,
  organizationId?: string,
): Promise<LeftoverMemberPeriodRow[]> {
  const organizationFilter = organizationId
    ? Prisma.sql`cb."organizationId" = ${organizationId}`
    : Prisma.sql`cb."organizationId" IS NOT NULL`;

  return await prisma.$queryRaw<LeftoverMemberPeriodRow[]>`
    SELECT
      cb.id,
      cb."referenceId",
      cb."organizationId",
      cb."userId",
      cb."expiresAt",
      cb."activatesAt",
      (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS remaining
    FROM credit_bucket cb
    LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
    WHERE ${organizationFilter}
      AND ${leftoverMemberPeriodWhereSql}
    GROUP BY
      cb.id,
      cb."referenceId",
      cb."organizationId",
      cb."userId",
      cb."expiresAt",
      cb."activatesAt"
  `;
}

async function resolveOrgMemberActorUserId(
  prisma: PrismaClient | Prisma.TransactionClient,
  organizationId: string,
): Promise<string | null> {
  const owner = await prisma.member.findFirst({
    where: {
      organizationId,
      role: "owner",
    },
    select: { userId: true },
  });
  if (owner) {
    return owner.userId;
  }

  const member = await prisma.member.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return member?.userId ?? null;
}

export async function collectOrgPeriodSentinelSpecs(
  prisma: PrismaClient | Prisma.TransactionClient,
  params: { debug?: SentinelDebugLog; organizationId?: string } = {},
): Promise<{
  specs: OrgPeriodSentinelSpec[];
  scannedLeftovers: number;
  unparseable: number;
}> {
  const debug = params.debug;
  const leftovers = await listLeftoverMemberPeriodRows(
    prisma,
    params.organizationId,
  );
  debug?.(
    `collect: scanned ${leftovers.length} leftover member: period row(s)` +
      (params.organizationId
        ? ` for organizationId=${params.organizationId}`
        : ""),
  );

  const byReferenceId = new Map<string, OrgPeriodSentinelSpec>();
  let unparseable = 0;

  for (const leftover of leftovers) {
    const parsed = parseMemberPeriodReferenceId(
      leftover.referenceId,
      leftover.organizationId,
    );
    if (parsed.isErr()) {
      unparseable += 1;
      debug?.(
        `collect: unparseable leftover id=${leftover.id} organizationId=${leftover.organizationId} referenceId=${leftover.referenceId} remaining=${leftover.remaining.toString()}`,
      );
      continue;
    }

    if (byReferenceId.has(parsed.value.orgReferenceId)) {
      debug?.(
        `collect: dedupe skip leftover id=${leftover.id} already covered by fingerprint=${parsed.value.orgReferenceId}`,
      );
      continue;
    }

    byReferenceId.set(parsed.value.orgReferenceId, {
      actorUserId: leftover.userId,
      activatesAt: leftover.activatesAt,
      expiresAt: leftover.expiresAt,
      kind: parsed.value.kind,
      organizationId: leftover.organizationId,
      referenceId: parsed.value.orgReferenceId,
      sourceBucketId: leftover.id,
    });
    debug?.(
      `collect: fingerprint kind=${parsed.value.kind} organizationId=${leftover.organizationId} referenceId=${parsed.value.orgReferenceId} sourceBucketId=${leftover.id} actorUserId=${leftover.userId}`,
    );
  }

  debug?.(
    `collect: distinctFingerprints=${byReferenceId.size} unparseable=${unparseable}`,
  );

  return {
    scannedLeftovers: leftovers.length,
    specs: [...byReferenceId.values()],
    unparseable,
  };
}

export async function orgPeriodFingerprintExists(
  prisma: PrismaClient | Prisma.TransactionClient,
  referenceId: OrgPeriodIdempotencyReferenceId,
): Promise<boolean> {
  const existing = await prisma.creditBucket.findUnique({
    where: {
      referenceId_referenceType: {
        referenceId,
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      },
    },
    select: { id: true },
  });
  return existing !== null;
}

export async function ensureOrgPeriodIdempotencySentinel(
  tx: Prisma.TransactionClient,
  spec: OrgPeriodSentinelSpec,
): Promise<"created" | "already_present"> {
  const existing = await tx.creditBucket.findUnique({
    where: {
      referenceId_referenceType: {
        referenceId: spec.referenceId,
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return "already_present";
  }

  try {
    const created = await tx.transaction.create({
      data: {
        amount: SENTINEL_FACE_CENTS,
        organizationId: spec.organizationId,
        userId: spec.actorUserId,
        sourceCreditBucket: {
          create: {
            activatesAt: spec.activatesAt,
            amount: SENTINEL_FACE_CENTS,
            expiresAt: sentinelExpiresAt(spec.expiresAt),
            organizationId: spec.organizationId,
            referenceId: spec.referenceId,
            referenceNote: SENTINEL_REFERENCE_NOTE,
            referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
            userId: null,
          },
        },
      },
      include: {
        sourceCreditBucket: {
          select: { id: true },
        },
      },
    });

    const bucketId = created.sourceCreditBucket?.id;
    if (!bucketId) {
      throw new Error(
        `SOK-905 sentinel create missing sourceCreditBucket for ${spec.referenceId}`,
      );
    }

    await tx.transaction.create({
      data: {
        amount: SENTINEL_FACE_CENTS * -1n,
        organizationId: spec.organizationId,
        userId: spec.actorUserId,
        creditConsumptions: {
          create: {
            amount: SENTINEL_FACE_CENTS,
            bucketId,
          },
        },
      },
    });

    return "created";
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      return "already_present";
    }
    throw error;
  }
}

export async function backfillOrgPeriodIdempotencySentinels(
  prisma: PrismaClient,
  params: SentinelOperationParams = {},
): Promise<SentinelBackfillResult> {
  const debug = params.debug;
  const { specs, scannedLeftovers, unparseable } =
    await collectOrgPeriodSentinelSpecs(prisma, {
      debug,
      organizationId: params.organizationId,
    });

  let created = 0;
  let alreadyPresent = 0;
  let skippedNoActor = 0;

  for (const [index, spec] of specs.entries()) {
    const step = `${index + 1}/${specs.length}`;
    let actorUserId = spec.actorUserId;
    if (!actorUserId) {
      actorUserId =
        (await resolveOrgMemberActorUserId(prisma, spec.organizationId)) ?? "";
      debug?.(
        `backfill [${step}] resolved actor organizationId=${spec.organizationId} actorUserId=${actorUserId || "(none)"}`,
      );
    }
    if (!actorUserId) {
      skippedNoActor += 1;
      debug?.(
        `backfill [${step}] skippedNoActor organizationId=${spec.organizationId} referenceId=${spec.referenceId} kind=${spec.kind}`,
      );
      continue;
    }

    if (params.dryRun) {
      const exists = await orgPeriodFingerprintExists(prisma, spec.referenceId);
      if (exists) {
        alreadyPresent += 1;
        debug?.(
          `backfill [${step}] dry-run alreadyPresent referenceId=${spec.referenceId}`,
        );
      } else {
        created += 1;
        debug?.(
          `backfill [${step}] dry-run wouldCreate referenceId=${spec.referenceId} kind=${spec.kind} organizationId=${spec.organizationId} actorUserId=${actorUserId}`,
        );
      }
      continue;
    }

    const outcome = await prisma.$transaction((tx) =>
      ensureOrgPeriodIdempotencySentinel(tx, {
        ...spec,
        actorUserId,
      }),
    );
    if (outcome === "created") {
      created += 1;
      debug?.(
        `backfill [${step}] created referenceId=${spec.referenceId} kind=${spec.kind} organizationId=${spec.organizationId} actorUserId=${actorUserId}`,
      );
    } else {
      alreadyPresent += 1;
      debug?.(
        `backfill [${step}] alreadyPresent referenceId=${spec.referenceId}`,
      );
    }
  }

  debug?.(
    `backfill done: scannedLeftovers=${scannedLeftovers} distinctFingerprints=${specs.length} created=${created} alreadyPresent=${alreadyPresent} skippedNoActor=${skippedNoActor} unparseable=${unparseable} dryRun=${Boolean(params.dryRun)}`,
  );

  return {
    alreadyPresent,
    created,
    distinctFingerprints: specs.length,
    scannedLeftovers,
    skippedNoActor,
    unparseable,
  };
}

export async function assertSentinelsCoverLeftoverMemberPeriods(
  prisma: PrismaClient | Prisma.TransactionClient,
  params: { debug?: SentinelDebugLog; organizationId?: string } = {},
): Promise<Result<void, SentinelCoverageFailure>> {
  const debug = params.debug;
  const { specs, unparseable } = await collectOrgPeriodSentinelSpecs(prisma, {
    debug,
    organizationId: params.organizationId,
  });

  const uncoveredReferenceIds: string[] = [];
  for (const spec of specs) {
    const covered = await orgPeriodFingerprintExists(prisma, spec.referenceId);
    if (!covered) {
      uncoveredReferenceIds.push(spec.referenceId);
      debug?.(
        `coverage: uncovered organizationId=${spec.organizationId} referenceId=${spec.referenceId} kind=${spec.kind}`,
      );
    } else {
      debug?.(
        `coverage: covered organizationId=${spec.organizationId} referenceId=${spec.referenceId}`,
      );
    }
  }

  if (unparseable > 0 || uncoveredReferenceIds.length > 0) {
    debug?.(
      `coverage: failed unparseable=${unparseable} uncovered=${uncoveredReferenceIds.length}`,
    );
    return err({ uncoveredReferenceIds, unparseable });
  }

  debug?.(`coverage: passed distinctFingerprints=${specs.length}`);
  return ok(undefined);
}

export async function deleteCoveredMemberPeriodTombstones(
  prisma: PrismaClient,
  params: SentinelOperationParams = {},
): Promise<TombstoneDeleteResult> {
  const debug = params.debug;
  const leftovers = await listLeftoverMemberPeriodRows(
    prisma,
    params.organizationId,
  );
  debug?.(
    `delete: scanned ${leftovers.length} leftover member: period row(s)` +
      (params.organizationId
        ? ` for organizationId=${params.organizationId}`
        : ""),
  );

  let deleted = 0;
  let skippedRemainingPositive = 0;
  let skippedUncovered = 0;
  let skippedUnparseable = 0;
  const deleteIds: string[] = [];

  for (const leftover of leftovers) {
    if (leftover.remaining > 0n) {
      skippedRemainingPositive += 1;
      debug?.(
        `delete: skip remaining>0 id=${leftover.id} organizationId=${leftover.organizationId} referenceId=${leftover.referenceId} remaining=${leftover.remaining.toString()}`,
      );
      continue;
    }

    const parsed = parseMemberPeriodReferenceId(
      leftover.referenceId,
      leftover.organizationId,
    );
    if (parsed.isErr()) {
      skippedUnparseable += 1;
      debug?.(
        `delete: skip unparseable id=${leftover.id} organizationId=${leftover.organizationId} referenceId=${leftover.referenceId}`,
      );
      continue;
    }

    if (
      !(await orgPeriodFingerprintExists(prisma, parsed.value.orgReferenceId))
    ) {
      skippedUncovered += 1;
      debug?.(
        `delete: skip uncovered id=${leftover.id} organizationId=${leftover.organizationId} referenceId=${leftover.referenceId} fingerprint=${parsed.value.orgReferenceId}`,
      );
      continue;
    }

    deleteIds.push(leftover.id);
    debug?.(
      `delete: ${params.dryRun ? "wouldDelete" : "queued"} id=${leftover.id} organizationId=${leftover.organizationId} referenceId=${leftover.referenceId} fingerprint=${parsed.value.orgReferenceId}`,
    );
  }

  if (!params.dryRun && deleteIds.length > 0) {
    const result = await prisma.creditBucket.deleteMany({
      where: { id: { in: deleteIds } },
    });
    deleted = result.count;
    debug?.(
      `delete: deleteMany count=${deleted} requested=${deleteIds.length}`,
    );
  } else {
    deleted = params.dryRun ? deleteIds.length : 0;
  }

  debug?.(
    `delete done: candidates=${leftovers.length} deleted=${deleted} skippedRemainingPositive=${skippedRemainingPositive} skippedUncovered=${skippedUncovered} skippedUnparseable=${skippedUnparseable} dryRun=${Boolean(params.dryRun)}`,
  );

  return {
    candidates: leftovers.length,
    deleted,
    skippedRemainingPositive,
    skippedUncovered,
    skippedUnparseable,
  };
}
