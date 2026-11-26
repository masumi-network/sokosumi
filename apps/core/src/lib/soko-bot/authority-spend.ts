import { type Prisma } from "@sokosumi/database";
import {
  type OwnerAuthority,
  type OwnerAuthorityTargetScope,
} from "@sokosumi/soko-bot";
import { z } from "zod";
import {
  SokoBotImageRefusedError,
  SokoBotRuntimeValidationError,
} from "@/services/soko-bot-runtime.service";

export const AUTHORITY_SPEND_STATUS = {
  RESERVED: "RESERVED",
  SETTLED: "SETTLED",
  UNKNOWN: "UNKNOWN",
  RELEASED: "RELEASED",
} as const;

export type AuthoritySpendStatus =
  (typeof AUTHORITY_SPEND_STATUS)[keyof typeof AUTHORITY_SPEND_STATUS];

const ACTIVE_SPEND_STATUSES: readonly AuthoritySpendStatus[] = [
  AUTHORITY_SPEND_STATUS.RESERVED,
  AUTHORITY_SPEND_STATUS.SETTLED,
  AUTHORITY_SPEND_STATUS.UNKNOWN,
];

export interface MediaSpendGrant {
  grantId: string;
  images?: number;
  videos?: number;
  maxMediaCredits?: number;
  targetScope: OwnerAuthorityTargetScope;
  /** Pre-migration turns whose legacy `sokoBotToolCall` rows may lack a ledger row. */
  legacyTurnIds?: readonly string[];
}

export interface MediaSpendRequest {
  sokoBotId: string;
  workspaceId: string;
  turnId: string;
  toolCallId: string;
  operationKey: string | null;
  capability: "generate_image" | "generate_video";
  projectId: string;
  images: number;
  videos: number;
  credits: number;
  grants: readonly MediaSpendGrant[];
}

export interface SummarizedMediaGrants {
  /** True when at least one owner-originated delegation authorized media without explicit limits and no limited grant restricts this wake. */
  unboundedPerTurn: boolean;
  grants: MediaSpendGrant[];
}

function minOptional(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function hasExplicitMediaLimit(grant: {
  images?: number;
  videos?: number;
  maxMediaCredits?: number;
}): boolean {
  return (
    grant.images !== undefined ||
    grant.videos !== undefined ||
    grant.maxMediaCredits !== undefined
  );
}

/**
 * Collapses effective owner-originated authorities carried on one wake into
 * distinct spend buckets keyed by `grantId`:
 * - Parallel children sharing ONE `grantId` NEVER sum their limits; they share
 *   one bucket with the tightest (`min`) limit on that `grantId`.
 * - Across distinct `grantId`s in a mixed wake, if ANY grant specifies media
 *   limits, unrelated unlimited plans in the same wake do NOT lift those limits
 *   — only grants carrying explicit limits authorize media on that wake.
 */
export function summarizeGrantBuckets(
  items: readonly {
    authority: OwnerAuthority;
    legacyTurnIds?: readonly string[];
  }[],
): SummarizedMediaGrants {
  if (!items.length) {
    return { unboundedPerTurn: false, grants: [] };
  }
  const byGrant = new Map<string, MediaSpendGrant>();
  for (const item of items) {
    const grantId = item.authority.limits?.grantId ?? item.authority.grantId;
    const existing = byGrant.get(grantId);
    const nextLegacyTurns = [
      ...new Set([
        ...(existing?.legacyTurnIds ?? []),
        ...(item.legacyTurnIds ?? []),
      ]),
    ];
    if (!existing) {
      byGrant.set(grantId, {
        grantId,
        images: item.authority.limits?.images,
        videos: item.authority.limits?.videos,
        maxMediaCredits: item.authority.limits?.maxMediaCredits,
        targetScope: item.authority.targetScope,
        ...(nextLegacyTurns.length ? { legacyTurnIds: nextLegacyTurns } : {}),
      });
      continue;
    }
    const targetScope =
      existing.targetScope.kind === "project"
        ? existing.targetScope
        : item.authority.targetScope;
    byGrant.set(grantId, {
      grantId,
      images: minOptional(existing.images, item.authority.limits?.images),
      videos: minOptional(existing.videos, item.authority.limits?.videos),
      maxMediaCredits: minOptional(
        existing.maxMediaCredits,
        item.authority.limits?.maxMediaCredits,
      ),
      targetScope,
      ...(nextLegacyTurns.length ? { legacyTurnIds: nextLegacyTurns } : {}),
    });
  }
  const all = Array.from(byGrant.values());
  const limited = all.filter(hasExplicitMediaLimit);
  if (limited.length > 0) {
    return { unboundedPerTurn: false, grants: limited };
  }
  return { unboundedPerTurn: true, grants: all };
}

/**
 * Selects grants whose `targetScope` permits `projectId`, prioritizing an
 * exact project match ahead of workspace-scoped grants, then `grantId` order.
 */
export function selectEligibleGrantsForProject(
  grants: readonly MediaSpendGrant[],
  projectId: string,
): MediaSpendGrant[] {
  return grants
    .filter(
      (grant) =>
        grant.targetScope.kind !== "project" ||
        grant.targetScope.projectId === projectId,
    )
    .sort((left, right) => {
      const leftExact =
        left.targetScope.kind === "project" &&
        left.targetScope.projectId === projectId
          ? 0
          : 1;
      const rightExact =
        right.targetScope.kind === "project" &&
        right.targetScope.projectId === projectId
          ? 0
          : 1;
      if (leftExact !== rightExact) return leftExact - rightExact;
      return left.grantId.localeCompare(right.grantId);
    });
}

type SpendReadClient = Partial<
  Pick<Prisma.TransactionClient, "sokoBotAuthoritySpend" | "sokoBotToolCall">
>;

interface GrantUsage {
  images: number;
  videos: number;
  credits: number;
}

const legacyMediaInputSchema = z.object({
  maxCredits: z.number().optional(),
  projectId: z.string().optional(),
});

async function readEligibleGrantUsages(
  client: SpendReadClient,
  sokoBotId: string,
  eligible: readonly MediaSpendGrant[],
  exclude: {
    turnId: string;
    toolCallId: string;
    operationKey: string | null;
  },
): Promise<Map<string, GrantUsage>> {
  const usageByGrant = new Map<string, GrantUsage>();
  const coveredCalls = new Set<string>();
  const coveredOperationKeys = new Set<string>();

  for (const grant of eligible) {
    const ledgerRows =
      typeof client.sokoBotAuthoritySpend?.findMany === "function"
        ? await client.sokoBotAuthoritySpend.findMany({
            where: {
              sokoBotId,
              grantId: grant.grantId,
              status: { in: [...ACTIVE_SPEND_STATUSES] },
              NOT: { turnId: exclude.turnId, toolCallId: exclude.toolCallId },
            },
            select: {
              turnId: true,
              toolCallId: true,
              operationKey: true,
              images: true,
              videos: true,
              credits: true,
            },
          })
        : [];

    const filteredLedger = ledgerRows.filter(
      (row) =>
        !(
          exclude.operationKey !== null &&
          row.operationKey !== null &&
          row.operationKey === exclude.operationKey
        ),
    );

    let images = 0;
    let videos = 0;
    let credits = 0;
    for (const row of filteredLedger) {
      images += row.images;
      videos += row.videos;
      credits += row.credits;
      coveredCalls.add(`${row.turnId}:${row.toolCallId}`);
      if (row.operationKey) coveredOperationKeys.add(row.operationKey);
    }
    usageByGrant.set(grant.grantId, { images, videos, credits });
  }

  // Rolling-deploy & pre-migration fallback: include any legacy tool calls on
  // `legacyTurnIds` written before SokoBotAuthoritySpend existed.
  // - Exclude calls that already have an active ledger row under ANY grantId.
  // - Exclude REJECTED and ALREADY_SATISFIED replay markers (`replayedReceiptId != null`).
  // - Count each distinct historical paid action ONCE across multiple old grants
  //   sharing a wake instead of charging the same historical call against each grant.
  const allLegacyTurnIds = [
    ...new Set(eligible.flatMap((grant) => grant.legacyTurnIds ?? [])),
  ];
  if (
    allLegacyTurnIds.length > 0 &&
    typeof client.sokoBotToolCall?.findMany === "function"
  ) {
    if (typeof client.sokoBotAuthoritySpend?.findMany === "function") {
      const anyLedgerOnLegacyTurns =
        await client.sokoBotAuthoritySpend.findMany({
          where: {
            turnId: { in: allLegacyTurnIds },
            status: { in: [...ACTIVE_SPEND_STATUSES] },
          },
          select: { turnId: true, toolCallId: true, operationKey: true },
        });
      for (const row of anyLedgerOnLegacyTurns) {
        coveredCalls.add(`${row.turnId}:${row.toolCallId}`);
        if (row.operationKey) coveredOperationKeys.add(row.operationKey);
      }
    }

    const legacyCalls = await client.sokoBotToolCall.findMany({
      where: {
        turnId: { in: allLegacyTurnIds },
        capability: { in: ["generate_image", "generate_video"] },
        replayedReceiptId: null,
        OR: [
          { disposition: null },
          { disposition: { notIn: ["REJECTED", "ALREADY_SATISFIED"] } },
        ],
        NOT: { turnId: exclude.turnId, toolCallId: exclude.toolCallId },
      },
      select: {
        turnId: true,
        toolCallId: true,
        operationKey: true,
        disposition: true,
        replayedReceiptId: true,
        capability: true,
        input: true,
      },
    });

    const seenCallKeys = new Set<string>();
    const seenLegacyOpKeys = new Set<string>();
    const unassignedLegacy = legacyCalls
      .filter((call) => {
        if (
          call.turnId === exclude.turnId &&
          call.toolCallId === exclude.toolCallId
        ) {
          return false;
        }
        if (
          call.disposition === "REJECTED" ||
          call.disposition === "ALREADY_SATISFIED" ||
          call.replayedReceiptId != null
        ) {
          return false;
        }
        const key = `${call.turnId}:${call.toolCallId}`;
        if (coveredCalls.has(key) || seenCallKeys.has(key)) return false;
        if (call.operationKey) {
          if (
            call.operationKey === exclude.operationKey ||
            coveredOperationKeys.has(call.operationKey) ||
            seenLegacyOpKeys.has(call.operationKey)
          ) {
            return false;
          }
          seenLegacyOpKeys.add(call.operationKey);
        }
        seenCallKeys.add(key);
        return true;
      })
      .sort((left, right) =>
        `${left.turnId}:${left.toolCallId}`.localeCompare(
          `${right.turnId}:${right.toolCallId}`,
        ),
      );

    for (const call of unassignedLegacy) {
      const parsedInput = legacyMediaInputSchema.safeParse(call.input).data;
      const callCost = {
        images: call.capability === "generate_image" ? 1 : 0,
        videos: call.capability === "generate_video" ? 1 : 0,
        credits: parsedInput?.maxCredits ?? 0,
      };
      const turnMatchingGrants = eligible.filter((grant) =>
        grant.legacyTurnIds?.includes(call.turnId),
      );
      if (!turnMatchingGrants.length) continue;
      const scopedCandidates = parsedInput?.projectId
        ? selectEligibleGrantsForProject(
            turnMatchingGrants,
            parsedInput.projectId,
          )
        : turnMatchingGrants;
      const candidates = scopedCandidates.length
        ? scopedCandidates
        : turnMatchingGrants;
      const assigned =
        candidates.find(
          (grant) =>
            grantRefusalMessage(
              grant,
              usageByGrant.get(grant.grantId)!,
              callCost,
            ) === null,
        ) ?? candidates[0]!;
      const bucket = usageByGrant.get(assigned.grantId)!;
      bucket.images += callCost.images;
      bucket.videos += callCost.videos;
      bucket.credits += callCost.credits;
    }
  }

  return usageByGrant;
}

function grantRefusalMessage(
  grant: MediaSpendGrant,
  usage: GrantUsage,
  requested: { images: number; videos: number; credits: number },
): string | null {
  if (
    grant.images !== undefined &&
    requested.images > 0 &&
    usage.images + requested.images > grant.images
  ) {
    return `The owner asked for ${grant.images} image${grant.images > 1 ? "s" : ""} in this plan. Use those in the draft.`;
  }
  if (
    grant.videos !== undefined &&
    requested.videos > 0 &&
    usage.videos + requested.videos > grant.videos
  ) {
    return `The owner asked for ${grant.videos} video${grant.videos > 1 ? "s" : ""} in this plan. Use those in the draft.`;
  }
  if (
    grant.maxMediaCredits !== undefined &&
    usage.credits + requested.credits > grant.maxMediaCredits
  ) {
    return `The owner allowed ${grant.maxMediaCredits} credits on media for this plan, and ${usage.credits} are set aside already. Make it fit with a lower maxCredits, or tell the owner what more would cost.`;
  }
  return null;
}

/**
 * Non-locking preflight capacity check across eligible grants for `projectId`.
 * Throws `SokoBotRuntimeValidationError` if no eligible grant can accommodate
 * the requested media spend.
 */
export async function checkGrantSpendPreflight(
  client: SpendReadClient,
  request: MediaSpendRequest,
): Promise<void> {
  if (!request.grants.length) return;
  const eligible = selectEligibleGrantsForProject(
    request.grants,
    request.projectId,
  );
  if (!eligible.length) {
    throw new SokoBotRuntimeValidationError(
      "The owner's media authorization for this follow-up is scoped to a different Project.",
    );
  }
  const usageByGrant = await readEligibleGrantUsages(
    client,
    request.sokoBotId,
    eligible,
    {
      turnId: request.turnId,
      toolCallId: request.toolCallId,
      operationKey: request.operationKey,
    },
  );
  let firstRefusal: string | null = null;
  for (const grant of eligible) {
    const usage = usageByGrant.get(grant.grantId)!;
    const refusal = grantRefusalMessage(grant, usage, {
      images: request.images,
      videos: request.videos,
      credits: request.credits,
    });
    if (!refusal) return;
    firstRefusal ??= refusal;
  }
  throw new SokoBotRuntimeValidationError(
    firstRefusal ??
      "The owner's media allowance for this plan has been reached.",
  );
}

type SpendTxClient = Partial<
  Pick<
    Prisma.TransactionClient,
    "$executeRaw" | "sokoBotAuthoritySpend" | "sokoBotToolCall"
  >
>;

/**
 * Atomically reserves media spend against one shared `grantId` inside an active
 * `serializableTransaction` at the durable external-effect dispatch boundary.
 *
 * - Acquires `pg_advisory_xact_lock` per `(sokoBotId, grantId)` in strictly
 *   sorted order so concurrent parallel children and overlapping mixed wakes
 *   serialize cleanly without deadlocking.
 * - Idempotent per `operationKey` and per `(turnId, toolCallId)`: retries of
 *   one paid action across children settle a single reservation.
 * - Refuses before provider dispatch with `SokoBotImageRefusedError` (an unsent
 *   refusal), rolling back the reservation transaction cleanly.
 */
export async function reserveAuthoritySpend(
  tx: SpendTxClient,
  request: MediaSpendRequest,
): Promise<{ grantId: string; reused: boolean } | null> {
  if (!request.grants.length) return null;
  if (typeof tx.sokoBotAuthoritySpend?.upsert !== "function") {
    await checkGrantSpendPreflight(tx, request);
    return null;
  }

  const eligible = selectEligibleGrantsForProject(
    request.grants,
    request.projectId,
  );
  if (!eligible.length) {
    throw new SokoBotImageRefusedError(
      "The owner's media authorization for this follow-up is scoped to a different Project.",
    );
  }

  // Acquire advisory locks in deterministic sorted order to prevent deadlocks
  // when concurrent mixed wakes touch overlapping grantIds.
  const lockIds = [...new Set(eligible.map((grant) => grant.grantId))].sort();
  if (typeof tx.$executeRaw === "function") {
    for (const grantId of lockIds) {
      const lockKey = `soko-bot-authority-spend:${request.sokoBotId}:${grantId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::TEXT, 0))`;
    }
  }

  // Settle once per operationKey: if another child or retry already holds an
  // active reservation/settlement for this exact operationKey, do not charge
  // the shared grant a second time.
  if (
    request.operationKey !== null &&
    typeof tx.sokoBotAuthoritySpend.findUnique === "function"
  ) {
    const existingByOp = await tx.sokoBotAuthoritySpend.findUnique({
      where: { operationKey: request.operationKey },
      select: { grantId: true, status: true },
    });
    if (
      existingByOp &&
      existingByOp.status !== AUTHORITY_SPEND_STATUS.RELEASED
    ) {
      return { grantId: existingByOp.grantId, reused: true };
    }
  }

  if (typeof tx.sokoBotAuthoritySpend.findUnique === "function") {
    const existingByCall = await tx.sokoBotAuthoritySpend.findUnique({
      where: {
        turnId_toolCallId: {
          turnId: request.turnId,
          toolCallId: request.toolCallId,
        },
      },
      select: { grantId: true, status: true },
    });
    if (
      existingByCall &&
      existingByCall.status !== AUTHORITY_SPEND_STATUS.RELEASED
    ) {
      return { grantId: existingByCall.grantId, reused: true };
    }
  }

  const usageByGrant = await readEligibleGrantUsages(
    tx,
    request.sokoBotId,
    eligible,
    {
      turnId: request.turnId,
      toolCallId: request.toolCallId,
      operationKey: request.operationKey,
    },
  );
  let chosen: MediaSpendGrant | null = null;
  let firstRefusal: string | null = null;
  for (const grant of eligible) {
    const usage = usageByGrant.get(grant.grantId)!;
    const refusal = grantRefusalMessage(grant, usage, {
      images: request.images,
      videos: request.videos,
      credits: request.credits,
    });
    if (!refusal) {
      chosen = grant;
      break;
    }
    firstRefusal ??= refusal;
  }

  if (!chosen) {
    throw new SokoBotImageRefusedError(
      firstRefusal ??
        "The owner's media allowance for this plan has been reached.",
    );
  }

  await tx.sokoBotAuthoritySpend.upsert({
    where: {
      turnId_toolCallId: {
        turnId: request.turnId,
        toolCallId: request.toolCallId,
      },
    },
    create: {
      sokoBotId: request.sokoBotId,
      workspaceId: request.workspaceId,
      grantId: chosen.grantId,
      operationKey: request.operationKey,
      turnId: request.turnId,
      toolCallId: request.toolCallId,
      capability: request.capability,
      images: request.images,
      videos: request.videos,
      credits: request.credits,
      status: AUTHORITY_SPEND_STATUS.RESERVED,
    },
    update: {
      grantId: chosen.grantId,
      operationKey: request.operationKey,
      capability: request.capability,
      images: request.images,
      videos: request.videos,
      credits: request.credits,
      status: AUTHORITY_SPEND_STATUS.RESERVED,
    },
  });

  return { grantId: chosen.grantId, reused: false };
}

type SpendUpdateClient = Partial<
  Pick<Prisma.TransactionClient, "sokoBotAuthoritySpend">
>;

/**
 * Transitions a reserved spend row to its final disposition:
 * - `SETTLED`: provider confirmed submission; stays held permanently.
 * - `UNKNOWN`: ambiguous failure or `SUBMISSION_UNCERTAIN`; stays held
 *   permanently so retries cannot double-spend.
 * - `RELEASED`: refused BEFORE provider dispatch (`SokoBotRefusedUnsentError`);
 *   releases both quota and `operationKey` so a corrected retry can proceed.
 */
export async function settleAuthoritySpend(
  client: SpendUpdateClient,
  key: { turnId: string; toolCallId: string },
  outcome: "SETTLED" | "UNKNOWN" | "RELEASED",
): Promise<void> {
  if (typeof client.sokoBotAuthoritySpend?.updateMany !== "function") return;
  if (outcome === "SETTLED") {
    await client.sokoBotAuthoritySpend.updateMany({
      where: {
        turnId: key.turnId,
        toolCallId: key.toolCallId,
        status: {
          in: [AUTHORITY_SPEND_STATUS.RESERVED, AUTHORITY_SPEND_STATUS.UNKNOWN],
        },
      },
      data: { status: AUTHORITY_SPEND_STATUS.SETTLED },
    });
    return;
  }
  if (outcome === "UNKNOWN") {
    await client.sokoBotAuthoritySpend.updateMany({
      where: {
        turnId: key.turnId,
        toolCallId: key.toolCallId,
        status: AUTHORITY_SPEND_STATUS.RESERVED,
      },
      data: { status: AUTHORITY_SPEND_STATUS.UNKNOWN },
    });
    return;
  }
  await client.sokoBotAuthoritySpend.updateMany({
    where: {
      turnId: key.turnId,
      toolCallId: key.toolCallId,
      status: AUTHORITY_SPEND_STATUS.RESERVED,
    },
    data: {
      status: AUTHORITY_SPEND_STATUS.RELEASED,
      operationKey: null,
    },
  });
}
