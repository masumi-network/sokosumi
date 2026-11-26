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
  /**
   * When multiple delegations from the same owner request share one `grantId`
   * across distinct Projects (e.g. Project A and Project B sharing one 2-image
   * balance), lists every authorized `projectId` in sorted order so evaluation
   * is independent of row order while still rejecting unauthorized Projects.
   */
  allowedProjectIds?: readonly string[];
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
  const byGrantItems = new Map<
    string,
    {
      authority: OwnerAuthority;
      legacyTurnIds?: readonly string[];
    }[]
  >();
  for (const item of items) {
    const grantId = item.authority.limits?.grantId ?? item.authority.grantId;
    const list = byGrantItems.get(grantId);
    if (list) {
      list.push(item);
    } else {
      byGrantItems.set(grantId, [item]);
    }
  }

  const all: MediaSpendGrant[] = [];
  for (const [grantId, group] of byGrantItems) {
    let images: number | undefined;
    let videos: number | undefined;
    let maxMediaCredits: number | undefined;
    const legacyTurnsSet = new Set<string>();
    for (const item of group) {
      images = minOptional(images, item.authority.limits?.images);
      videos = minOptional(videos, item.authority.limits?.videos);
      maxMediaCredits = minOptional(
        maxMediaCredits,
        item.authority.limits?.maxMediaCredits,
      );
      for (const turnId of item.legacyTurnIds ?? []) {
        legacyTurnsSet.add(turnId);
      }
    }

    // Scope union is computed order-independently across the group's
    // limit-bearing items (if any), so parallel delegations from one owner
    // request targeting Project A and Project B retain both Projects under
    // their single shared grantId regardless of row order.
    const limitedInGroup = group.filter((item) =>
      item.authority.limits
        ? hasExplicitMediaLimit(item.authority.limits)
        : false,
    );
    const scopeItems = limitedInGroup.length > 0 ? limitedInGroup : group;
    const nonProjectScope = scopeItems.find(
      (item) => item.authority.targetScope.kind !== "project",
    )?.authority.targetScope;

    let targetScope: OwnerAuthorityTargetScope;
    let allowedProjectIds: string[] | undefined;
    if (nonProjectScope) {
      targetScope = nonProjectScope;
    } else {
      const projectIds = [
        ...new Set(
          scopeItems.flatMap((item) =>
            item.authority.targetScope.kind === "project"
              ? [item.authority.targetScope.projectId]
              : [],
          ),
        ),
      ].sort();
      targetScope = { kind: "project", projectId: projectIds[0]! };
      if (projectIds.length > 1) {
        allowedProjectIds = projectIds;
      }
    }

    const legacyTurnIds = [...legacyTurnsSet];
    all.push({
      grantId,
      images,
      videos,
      maxMediaCredits,
      targetScope,
      ...(allowedProjectIds ? { allowedProjectIds } : {}),
      ...(legacyTurnIds.length ? { legacyTurnIds } : {}),
    });
  }

  const limited = all.filter(hasExplicitMediaLimit);
  if (limited.length > 0) {
    return { unboundedPerTurn: false, grants: limited };
  }
  return { unboundedPerTurn: true, grants: all };
}

const CREDIT_EPSILON = 1e-9;
const MAX_LEGACY_SEARCH_NODES = 10_000;

function formatCredits(value: number): string {
  return String(Number(value.toFixed(6)));
}

function grantAllowsProject(
  grant: Pick<MediaSpendGrant, "targetScope" | "allowedProjectIds">,
  projectId: string,
): boolean {
  if (grant.allowedProjectIds) {
    return grant.allowedProjectIds.includes(projectId);
  }
  return (
    grant.targetScope.kind !== "project" ||
    grant.targetScope.projectId === projectId
  );
}

function isProjectScopedGrant(
  grant: Pick<MediaSpendGrant, "targetScope" | "allowedProjectIds">,
): boolean {
  return (
    Boolean(grant.allowedProjectIds) || grant.targetScope.kind === "project"
  );
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
    .filter((grant) => grantAllowsProject(grant, projectId))
    .sort((left, right) => {
      const leftExact = isProjectScopedGrant(left) ? 0 : 1;
      const rightExact = isProjectScopedGrant(right) ? 0 : 1;
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

interface LegacySpendItem {
  key: string;
  cost: GrantUsage;
  compatibleGrants: MediaSpendGrant[];
}

const legacyMediaInputSchema = z.object({
  maxCredits: z.number().optional(),
  projectId: z.string().optional(),
});

function isTerminalRejectedToolCall(call: {
  disposition?: string | null;
  status?: string | null;
}): boolean {
  return (
    call.disposition === "REJECTED" &&
    (call.status === undefined ||
      call.status === "COMPLETED" ||
      call.status === "FAILED")
  );
}

/**
 * Finds `RESERVED` ledger rows whose durable `sokoBotToolCall` receipt is
 * already terminal `REJECTED` (e.g. from a crash between receipt commit and
 * ledger release on an older worker).
 */
async function findStrandedRejectedKeys(
  client: SpendReadClient,
  reservedPairs: readonly { turnId: string; toolCallId: string }[],
): Promise<Set<string>> {
  const stranded = new Set<string>();
  if (
    !reservedPairs.length ||
    typeof client.sokoBotToolCall?.findMany !== "function"
  ) {
    return stranded;
  }
  const wanted = new Set(
    reservedPairs.map((pair) => `${pair.turnId}:${pair.toolCallId}`),
  );
  const turnIds = [...new Set(reservedPairs.map((pair) => pair.turnId))];
  const toolCallIds = [
    ...new Set(reservedPairs.map((pair) => pair.toolCallId)),
  ];
  const calls = await client.sokoBotToolCall.findMany({
    where: {
      turnId: { in: turnIds },
      toolCallId: { in: toolCallIds },
      disposition: "REJECTED",
    },
    select: {
      turnId: true,
      toolCallId: true,
      status: true,
      disposition: true,
    },
  });
  for (const call of calls) {
    const key = `${call.turnId}:${call.toolCallId}`;
    if (wanted.has(key) && isTerminalRejectedToolCall(call)) {
      stranded.add(key);
    }
  }
  return stranded;
}

async function loadGrantAccounting(
  client: SpendReadClient,
  sokoBotId: string,
  allGrants: readonly MediaSpendGrant[],
  exclude: {
    turnId: string;
    toolCallId: string;
    operationKey: string | null;
  },
  options: { repairStranded: boolean },
): Promise<{
  ledgerUsageByGrant: Map<string, GrantUsage>;
  legacyItems: LegacySpendItem[];
}> {
  const ledgerUsageByGrant = new Map<string, GrantUsage>();
  const coveredCalls = new Set<string>();
  const coveredOperationKeys = new Set<string>();
  const rowsByGrant = new Map<
    string,
    {
      turnId: string;
      toolCallId: string;
      operationKey: string | null;
      status?: string;
      images: number;
      videos: number;
      credits: number;
    }[]
  >();
  const reservedToCheck: { turnId: string; toolCallId: string }[] = [];

  for (const grant of allGrants) {
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
              status: true,
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
    rowsByGrant.set(grant.grantId, filteredLedger);
    for (const row of filteredLedger) {
      if (row.status === AUTHORITY_SPEND_STATUS.RESERVED) {
        reservedToCheck.push({
          turnId: row.turnId,
          toolCallId: row.toolCallId,
        });
      }
    }
  }

  const strandedKeys = await findStrandedRejectedKeys(client, reservedToCheck);
  const repairedKeys = new Set<string>();

  for (const grant of allGrants) {
    const rows = rowsByGrant.get(grant.grantId) ?? [];
    let images = 0;
    let videos = 0;
    let credits = 0;
    for (const row of rows) {
      const key = `${row.turnId}:${row.toolCallId}`;
      if (
        row.status === AUTHORITY_SPEND_STATUS.RESERVED &&
        strandedKeys.has(key)
      ) {
        if (options.repairStranded && !repairedKeys.has(key)) {
          repairedKeys.add(key);
          await settleAuthoritySpend(
            client,
            { turnId: row.turnId, toolCallId: row.toolCallId },
            "RELEASED",
          );
        }
        continue;
      }
      images += row.images;
      videos += row.videos;
      credits += row.credits;
      coveredCalls.add(key);
      if (row.operationKey) coveredOperationKeys.add(row.operationKey);
    }
    ledgerUsageByGrant.set(grant.grantId, { images, videos, credits });
  }

  // Rolling-deploy & pre-migration fallback: collect unassigned legacy tool
  // calls across ALL grants on the wake (before Project filtering) so a
  // Project A legacy call binds to Project A's grant and never exhausts an
  // untouched Project B grant.
  const allLegacyTurnIds = [
    ...new Set(allGrants.flatMap((grant) => grant.legacyTurnIds ?? [])),
  ];
  const legacyItems: LegacySpendItem[] = [];
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
        const key = `${row.turnId}:${row.toolCallId}`;
        if (strandedKeys.has(key)) continue;
        coveredCalls.add(key);
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
      const turnMatchingGrants = allGrants.filter((grant) =>
        grant.legacyTurnIds?.includes(call.turnId),
      );
      if (!turnMatchingGrants.length) continue;
      // Known Project scopes only match grants covering that Project; never
      // fall back to a grant bound to a different Project.
      const compatibleGrants = parsedInput?.projectId
        ? selectEligibleGrantsForProject(
            turnMatchingGrants,
            parsedInput.projectId,
          )
        : [...turnMatchingGrants].sort((left, right) =>
            left.grantId.localeCompare(right.grantId),
          );
      if (!compatibleGrants.length) continue;
      legacyItems.push({
        key: `${call.turnId}:${call.toolCallId}`,
        cost: {
          images: call.capability === "generate_image" ? 1 : 0,
          videos: call.capability === "generate_video" ? 1 : 0,
          credits: parsedInput?.maxCredits ?? 0,
        },
        compatibleGrants,
      });
    }
  }

  // Order most-constrained legacy items first (fewest compatible grants, then
  // largest credit cost) so exact feasibility search resolves immediately.
  legacyItems.sort((left, right) => {
    if (left.compatibleGrants.length !== right.compatibleGrants.length) {
      return left.compatibleGrants.length - right.compatibleGrants.length;
    }
    if (left.cost.credits !== right.cost.credits) {
      return right.cost.credits - left.cost.credits;
    }
    return left.key.localeCompare(right.key);
  });

  return { ledgerUsageByGrant, legacyItems };
}

function grantRefusalMessage(
  grant: MediaSpendGrant,
  usage: GrantUsage,
  requested: GrantUsage,
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
    usage.credits + requested.credits > grant.maxMediaCredits + CREDIT_EPSILON
  ) {
    return `The owner allowed ${formatCredits(grant.maxMediaCredits)} credits on media for this plan, and ${formatCredits(usage.credits)} are set aside already. Make it fit with a lower maxCredits, or tell the owner what more would cost.`;
  }
  return null;
}

function cloneUsageMap(
  source: Map<string, GrantUsage>,
): Map<string, GrantUsage> {
  const copy = new Map<string, GrantUsage>();
  for (const [grantId, usage] of source) {
    copy.set(grantId, { ...usage });
  }
  return copy;
}

function remainingCredits(grant: MediaSpendGrant, usage: GrantUsage): number {
  return grant.maxMediaCredits === undefined
    ? Number.POSITIVE_INFINITY
    : grant.maxMediaCredits - usage.credits;
}

function grantHasCountRoom(
  grant: MediaSpendGrant,
  usage: GrantUsage,
  requested: GrantUsage,
): boolean {
  if (
    grant.images !== undefined &&
    requested.images > 0 &&
    usage.images + requested.images > grant.images
  ) {
    return false;
  }
  if (
    grant.videos !== undefined &&
    requested.videos > 0 &&
    usage.videos + requested.videos > grant.videos
  ) {
    return false;
  }
  return true;
}

function buildPooledLegacyCreditDeltas(
  slotGrant: MediaSpendGrant,
  item: LegacySpendItem,
  usageByGrant: Map<string, GrantUsage>,
): { grantId: string; credits: number }[] | null {
  const slotUsage = usageByGrant.get(slotGrant.grantId)!;
  const slotCap = Math.max(0, remainingCredits(slotGrant, slotUsage));
  const slotTake = Math.min(item.cost.credits, slotCap);
  let remaining = item.cost.credits - slotTake;
  const deltas: { grantId: string; credits: number }[] = [];
  if (slotTake > 0) {
    deltas.push({ grantId: slotGrant.grantId, credits: slotTake });
  }
  if (remaining <= CREDIT_EPSILON) return deltas;

  // Already-incurred pre-migration calls could legitimately draw credits from
  // the pooled total across multiple compatible legacy grants on the same wake.
  const otherGrants = item.compatibleGrants
    .filter((grant) => grant.grantId !== slotGrant.grantId)
    .sort((left, right) => {
      const leftRem = remainingCredits(left, usageByGrant.get(left.grantId)!);
      const rightRem = remainingCredits(
        right,
        usageByGrant.get(right.grantId)!,
      );
      if (Math.abs(leftRem - rightRem) > CREDIT_EPSILON) {
        return leftRem - rightRem;
      }
      return left.grantId.localeCompare(right.grantId);
    });
  for (const other of otherGrants) {
    if (remaining <= CREDIT_EPSILON) break;
    const otherCap = Math.max(
      0,
      remainingCredits(other, usageByGrant.get(other.grantId)!),
    );
    if (otherCap <= CREDIT_EPSILON) continue;
    const take = Math.min(remaining, otherCap);
    deltas.push({ grantId: other.grantId, credits: take });
    remaining -= take;
  }
  return remaining <= CREDIT_EPSILON ? deltas : null;
}

function canPlaceLegacyItems(
  items: readonly LegacySpendItem[],
  usageByGrant: Map<string, GrantUsage>,
): boolean {
  let nodesRemaining = MAX_LEGACY_SEARCH_NODES;

  const search = (index: number): boolean => {
    if (index >= items.length) return true;
    const item = items[index]!;
    // Try tightest-fitting compatible grants first so smaller legacy calls
    // leave larger grants available for higher-cost calls.
    const orderedGrants = [...item.compatibleGrants].sort((left, right) => {
      const leftExact = isProjectScopedGrant(left) ? 0 : 1;
      const rightExact = isProjectScopedGrant(right) ? 0 : 1;
      if (leftExact !== rightExact) return leftExact - rightExact;
      const leftRem = remainingCredits(left, usageByGrant.get(left.grantId)!);
      const rightRem = remainingCredits(
        right,
        usageByGrant.get(right.grantId)!,
      );
      if (Math.abs(leftRem - rightRem) > CREDIT_EPSILON) {
        return leftRem - rightRem;
      }
      return left.grantId.localeCompare(right.grantId);
    });

    const tryWholeGrant = (grant: MediaSpendGrant): boolean => {
      const bucket = usageByGrant.get(grant.grantId)!;
      if (grantRefusalMessage(grant, bucket, item.cost) !== null) return false;
      bucket.images += item.cost.images;
      bucket.videos += item.cost.videos;
      bucket.credits += item.cost.credits;
      if (search(index + 1)) return true;
      bucket.images -= item.cost.images;
      bucket.videos -= item.cost.videos;
      bucket.credits -= item.cost.credits;
      return false;
    };

    const trySpilloverGrant = (slotGrant: MediaSpendGrant): boolean => {
      if (item.compatibleGrants.length < 2 || item.cost.credits <= 0) {
        return false;
      }
      const slotBucket = usageByGrant.get(slotGrant.grantId)!;
      if (!grantHasCountRoom(slotGrant, slotBucket, item.cost)) return false;
      // Only spill when this grant couldn't absorb the whole call on its own.
      if (grantRefusalMessage(slotGrant, slotBucket, item.cost) === null) {
        return false;
      }
      const creditDeltas = buildPooledLegacyCreditDeltas(
        slotGrant,
        item,
        usageByGrant,
      );
      if (!creditDeltas) return false;
      slotBucket.images += item.cost.images;
      slotBucket.videos += item.cost.videos;
      for (const delta of creditDeltas) {
        usageByGrant.get(delta.grantId)!.credits += delta.credits;
      }
      if (search(index + 1)) return true;
      slotBucket.images -= item.cost.images;
      slotBucket.videos -= item.cost.videos;
      for (const delta of creditDeltas) {
        usageByGrant.get(delta.grantId)!.credits -= delta.credits;
      }
      return false;
    };

    if (nodesRemaining <= 0) {
      for (const grant of orderedGrants) {
        if (tryWholeGrant(grant)) return true;
      }
      for (const grant of orderedGrants) {
        if (trySpilloverGrant(grant)) return true;
      }
      return false;
    }

    for (const grant of orderedGrants) {
      if (
        grantRefusalMessage(
          grant,
          usageByGrant.get(grant.grantId)!,
          item.cost,
        ) !== null
      ) {
        continue;
      }
      nodesRemaining -= 1;
      if (tryWholeGrant(grant)) return true;
    }

    for (const grant of orderedGrants) {
      const slotBucket = usageByGrant.get(grant.grantId)!;
      if (
        item.compatibleGrants.length < 2 ||
        item.cost.credits <= 0 ||
        !grantHasCountRoom(grant, slotBucket, item.cost) ||
        grantRefusalMessage(grant, slotBucket, item.cost) === null
      ) {
        continue;
      }
      nodesRemaining -= 1;
      if (trySpilloverGrant(grant)) return true;
    }

    return false;
  };

  return search(0);
}

function connectedLegacyItems(
  candidateGrantId: string,
  legacyItems: readonly LegacySpendItem[],
): LegacySpendItem[] {
  if (!legacyItems.length) return [];
  const reachableGrants = new Set<string>([candidateGrantId]);
  const includedIndices = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < legacyItems.length; i += 1) {
      if (includedIndices.has(i)) continue;
      const item = legacyItems[i]!;
      if (
        item.compatibleGrants.some((grant) =>
          reachableGrants.has(grant.grantId),
        )
      ) {
        includedIndices.add(i);
        for (const grant of item.compatibleGrants) {
          reachableGrants.add(grant.grantId);
        }
        changed = true;
      }
    }
  }
  return legacyItems.filter((_, index) => includedIndices.has(index));
}

function selectFeasibleGrant(
  eligible: readonly MediaSpendGrant[],
  ledgerUsageByGrant: Map<string, GrantUsage>,
  legacyItems: readonly LegacySpendItem[],
  requested: GrantUsage,
): { chosen: MediaSpendGrant | null; refusal: string } {
  for (const grant of eligible) {
    const baseUsage = ledgerUsageByGrant.get(grant.grantId)!;
    if (grantRefusalMessage(grant, baseUsage, requested) !== null) continue;
    const relevantLegacy = connectedLegacyItems(grant.grantId, legacyItems);
    if (!relevantLegacy.length) {
      return { chosen: grant, refusal: "" };
    }
    const working = cloneUsageMap(ledgerUsageByGrant);
    const candidateBucket = working.get(grant.grantId)!;
    candidateBucket.images += requested.images;
    candidateBucket.videos += requested.videos;
    candidateBucket.credits += requested.credits;
    if (canPlaceLegacyItems(relevantLegacy, working)) {
      return { chosen: grant, refusal: "" };
    }
  }

  // No eligible grant can accommodate the request alongside historical spend.
  // Compute a baseline placement of legacy items alone to produce the clearest
  // refusal message.
  const baseline = cloneUsageMap(ledgerUsageByGrant);
  if (legacyItems.length > 0 && !canPlaceLegacyItems(legacyItems, baseline)) {
    const greedy = cloneUsageMap(ledgerUsageByGrant);
    for (const item of legacyItems) {
      const target =
        item.compatibleGrants.find(
          (grant) =>
            grantRefusalMessage(
              grant,
              greedy.get(grant.grantId)!,
              item.cost,
            ) === null,
        ) ?? item.compatibleGrants[0]!;
      const bucket = greedy.get(target.grantId)!;
      bucket.images += item.cost.images;
      bucket.videos += item.cost.videos;
      bucket.credits += item.cost.credits;
    }
    for (const grant of eligible) {
      const msg = grantRefusalMessage(
        grant,
        greedy.get(grant.grantId)!,
        requested,
      );
      if (msg) return { chosen: null, refusal: msg };
    }
  } else {
    for (const grant of eligible) {
      const msg = grantRefusalMessage(
        grant,
        baseline.get(grant.grantId)!,
        requested,
      );
      if (msg) return { chosen: null, refusal: msg };
    }
  }

  return {
    chosen: null,
    refusal: "The owner's media allowance for this plan has been reached.",
  };
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
  const { ledgerUsageByGrant, legacyItems } = await loadGrantAccounting(
    client,
    request.sokoBotId,
    request.grants,
    {
      turnId: request.turnId,
      toolCallId: request.toolCallId,
      operationKey: request.operationKey,
    },
    { repairStranded: false },
  );
  const { chosen, refusal } = selectFeasibleGrant(
    eligible,
    ledgerUsageByGrant,
    legacyItems,
    {
      images: request.images,
      videos: request.videos,
      credits: request.credits,
    },
  );
  if (!chosen) {
    throw new SokoBotRuntimeValidationError(refusal);
  }
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
 * - Repairs any previously stranded `RESERVED` row whose durable tool-call
 *   receipt is already terminal `REJECTED` before evaluating capacity.
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

  // Acquire advisory locks across ALL grants carried on the wake in
  // deterministic sorted order to prevent deadlocks when mixed wakes overlap.
  const lockIds = [
    ...new Set(request.grants.map((grant) => grant.grantId)),
  ].sort();
  if (typeof tx.$executeRaw === "function") {
    for (const grantId of lockIds) {
      const lockKey = `soko-bot-authority-spend:${request.sokoBotId}:${grantId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::TEXT, 0))`;
    }
  }

  // Settle once per operationKey: if another child or retry already holds an
  // active reservation/settlement for this exact operationKey, do not charge
  // the shared grant a second time. If the existing row is a stranded RESERVED
  // row whose durable tool-call receipt is already REJECTED, release it first.
  if (
    request.operationKey !== null &&
    typeof tx.sokoBotAuthoritySpend.findUnique === "function"
  ) {
    const existingByOp = await tx.sokoBotAuthoritySpend.findUnique({
      where: { operationKey: request.operationKey },
      select: { grantId: true, status: true, turnId: true, toolCallId: true },
    });
    if (
      existingByOp &&
      existingByOp.status !== AUTHORITY_SPEND_STATUS.RELEASED
    ) {
      const isStranded =
        existingByOp.status === AUTHORITY_SPEND_STATUS.RESERVED &&
        existingByOp.turnId &&
        existingByOp.toolCallId &&
        (
          await findStrandedRejectedKeys(tx, [
            {
              turnId: existingByOp.turnId,
              toolCallId: existingByOp.toolCallId,
            },
          ])
        ).has(`${existingByOp.turnId}:${existingByOp.toolCallId}`);
      if (isStranded) {
        await settleAuthoritySpend(
          tx,
          { turnId: existingByOp.turnId, toolCallId: existingByOp.toolCallId },
          "RELEASED",
        );
      } else {
        return { grantId: existingByOp.grantId, reused: true };
      }
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
      const isStranded =
        existingByCall.status === AUTHORITY_SPEND_STATUS.RESERVED &&
        (
          await findStrandedRejectedKeys(tx, [
            { turnId: request.turnId, toolCallId: request.toolCallId },
          ])
        ).has(`${request.turnId}:${request.toolCallId}`);
      if (isStranded) {
        await settleAuthoritySpend(
          tx,
          { turnId: request.turnId, toolCallId: request.toolCallId },
          "RELEASED",
        );
      } else {
        return { grantId: existingByCall.grantId, reused: true };
      }
    }
  }

  const { ledgerUsageByGrant, legacyItems } = await loadGrantAccounting(
    tx,
    request.sokoBotId,
    request.grants,
    {
      turnId: request.turnId,
      toolCallId: request.toolCallId,
      operationKey: request.operationKey,
    },
    { repairStranded: true },
  );
  const { chosen, refusal } = selectFeasibleGrant(
    eligible,
    ledgerUsageByGrant,
    legacyItems,
    {
      images: request.images,
      videos: request.videos,
      credits: request.credits,
    },
  );

  if (!chosen) {
    throw new SokoBotImageRefusedError(refusal);
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
