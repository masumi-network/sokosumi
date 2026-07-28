import { z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import {
  AgentEntryType,
  AgentStatus,
  PaymentType,
  PricingType,
  type Prisma,
  RiskClassification,
} from "@sokosumi/database";
import {
  isV2RegistryIdentifier,
  parseVersionedAgentIdentifier,
} from "@sokosumi/masumi";
import type { PostRegistryDiffResponse } from "@sokosumi/masumi/clients";

import { paymentClient } from "@/clients/masumi-payment.client";
import { registryClient } from "@/clients/masumi-registry.client";
import { openrouterClient } from "@/clients/openrouter.client";
import { getEnv } from "@/config/env";
import {
  CARDANO_V2_RAIL_READINESS_FAILURE_KEY,
  CARDANO_V2_RAIL_READINESS_KEY,
  type CardanoV2ReadySource,
  getAgentDescription,
  getCardanoV2ReadySources,
  isCardanoV2SourceReady,
  normalizeMasumiPaymentUnit,
} from "@/helpers/agent";
import prisma from "@/lib/db/prisma";

const AGENT_SUMMARY_SYNC_LIMIT = 20;
/**
 * The per-entry upsert transaction fans out across pricing, payment sources,
 * example outputs and — on a rollback-era collision — relation consolidation,
 * so Prisma's 5s default is too tight to be safe here: a timeout rolls the
 * park back and parks the sync cursor on a permanently failing entry.
 */
const AGENT_UPSERT_TRANSACTION_OPTIONS = { timeout: 20_000 } as const;
const AGENT_SYNC_BATCH_SIZE = 50;
const CARDANO_V2_SYNC_METADATA_SUFFIX = "-cardano-v2";

interface SyncExecutionOptions {
  abortSignal: AbortSignal;
  shouldContinue: () => boolean;
}

function isValidEmail(email: string | null | undefined): email is string {
  if (!email) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function emptyStringToNull(value: string | null | undefined): string | null {
  if (!value || value === "") {
    return null;
  }

  return value;
}

function convertStatus(
  status: "Online" | "Offline" | "Deregistered" | "Invalid" | unknown,
): AgentStatus {
  switch (status) {
    case "Online":
      return AgentStatus.ONLINE;
    case "Offline":
      return AgentStatus.OFFLINE;
    case "Deregistered":
      return AgentStatus.DEREGISTERED;
    case "Invalid":
      return AgentStatus.INVALID;
    default:
      return AgentStatus.INVALID;
  }
}

function convertPaymentType(
  paymentType: "Web3CardanoV1" | "Web3CardanoV2" | "None" | unknown,
) {
  switch (paymentType) {
    case "Web3CardanoV1":
      return PaymentType.WEB3_CARDANO_V1;
    case "Web3CardanoV2":
      return PaymentType.WEB3_CARDANO_V2;
    case "None":
      return PaymentType.NONE;
    default:
      return PaymentType.UNKNOWN;
  }
}

function convertEntryType(
  type: "Standard" | "OpenApi" | "X402" | unknown,
): AgentEntryType {
  switch (type) {
    case undefined:
    case null:
    case "Standard":
      return AgentEntryType.STANDARD;
    case "OpenApi":
      return AgentEntryType.OPEN_API;
    case "X402":
      return AgentEntryType.X402;
    default:
      return AgentEntryType.UNKNOWN;
  }
}

// The registry serves AgentPricing as a loose union (V2 entries have no
// top-level pricing at all), so validate structurally instead of trusting the
// generated type.
const registryAgentPricingSchema = z.object({
  pricingType: z.string(),
  FixedPricing: z
    .object({
      Amounts: z.array(z.object({ amount: z.string(), unit: z.string() })),
    })
    .optional(),
});

interface ParsedAgentPricing {
  pricingType: PricingType;
  fixedPricingAmounts?: { amount: bigint; unit: string }[];
}

function parseEntryAgentPricing(
  pricing: unknown,
  agentIdentifier: string,
): ParsedAgentPricing {
  if (pricing === null || pricing === undefined) {
    // Legitimate for V2/pointer entries (pricing is per payment source).
    return {
      pricingType: PricingType.UNKNOWN,
    };
  }
  const parsed = registryAgentPricingSchema.safeParse(pricing);
  if (!parsed.success) {
    console.warn(
      `[sync/agents] Malformed pricing for entry ${agentIdentifier}; storing as UNKNOWN (agent stays unavailable)`,
    );
    return {
      pricingType: PricingType.UNKNOWN,
    };
  }

  switch (parsed.data.pricingType) {
    case "Fixed": {
      const amounts = parsed.data.FixedPricing?.Amounts ?? [];

      // Intentionally treat empty/invalid fixed pricing as unknown to avoid
      // exposing malformed registry pricing as a valid fixed-price agent.
      // BigInt() throws on non-numeric strings, so it must stay guarded.
      try {
        const isValidFixedPricing = amounts.every(
          (amount) => BigInt(amount.amount) > 0,
        );
        if (!isValidFixedPricing || amounts.length === 0) {
          return {
            pricingType: PricingType.UNKNOWN,
          };
        }

        return {
          pricingType: PricingType.FIXED,
          fixedPricingAmounts: amounts.map((amount) => ({
            amount: BigInt(amount.amount),
            unit: normalizeMasumiPaymentUnit(amount.unit),
          })),
        };
      } catch {
        console.warn(
          `[sync/agents] Non-numeric fixed pricing amount for entry ${agentIdentifier}; storing as UNKNOWN (agent stays unavailable)`,
        );
        return {
          pricingType: PricingType.UNKNOWN,
        };
      }
    }
    case "Free": {
      return {
        pricingType: PricingType.FREE,
      };
    }
    default: {
      return {
        pricingType: PricingType.UNKNOWN,
      };
    }
  }
}

type RegistryDiffEntry = PostRegistryDiffResponse["data"]["entries"][number];
type RegistryPaymentSource =
  RegistryDiffEntry["SupportedPaymentSources"][number];

function normalizeRegistryIdentifier(identifier: string): string {
  return isV2RegistryIdentifier(identifier)
    ? identifier.toLowerCase()
    : identifier;
}

function normalizeRegistryEntry(entry: RegistryDiffEntry): RegistryDiffEntry {
  return {
    ...entry,
    agentIdentifier: normalizeRegistryIdentifier(entry.agentIdentifier),
    supersededByAgentIdentifier: entry.supersededByAgentIdentifier
      ? normalizeRegistryIdentifier(entry.supersededByAgentIdentifier)
      : entry.supersededByAgentIdentifier,
  };
}

interface RegistryAgentVersion {
  registryIdentity: string;
  registryVersion: number;
  isValid: boolean;
}

function resolveRegistryAgentVersion(
  entry: RegistryDiffEntry,
): RegistryAgentVersion {
  // Version semantics are a property of the V2 registry POLICY, not of the
  // payment type: free and EVM-only V2 agents carry paymentType "None" but
  // are still versioned. Keying on the policy prefix (like the registry
  // service does) keeps one stable Agent row across their revisions too.
  if (!isV2RegistryIdentifier(entry.agentIdentifier)) {
    return {
      registryIdentity: entry.agentIdentifier,
      registryVersion: 0,
      isValid: true,
    };
  }

  const parsed = parseVersionedAgentIdentifier(entry.agentIdentifier);
  if (!parsed) {
    console.warn(
      `[sync/agents] Invalid V2 version suffix for entry ${entry.agentIdentifier}; storing as unavailable`,
    );
    return {
      registryIdentity: entry.agentIdentifier,
      registryVersion: 0,
      isValid: false,
    };
  }

  return {
    ...parsed,
    isValid: true,
  };
}

/**
 * Projects a registry payment source's own pricing into the local pricing
 * shape. Dynamic pricing is unsupported and maps to UNKNOWN (agent stays
 * unavailable), matching the V1 behavior.
 */
function projectSourcePricing(
  pricing: RegistryPaymentSource["pricing"],
  agentIdentifier: string,
): ParsedAgentPricing {
  switch (pricing.pricingType) {
    case "Fixed": {
      try {
        const amounts = pricing.fixed.map((fixedAmount) => ({
          unit: normalizeMasumiPaymentUnit(fixedAmount.asset),
          amount: BigInt(fixedAmount.amount),
        }));
        if (amounts.length === 0 || amounts.some((row) => row.amount <= 0n)) {
          return { pricingType: PricingType.UNKNOWN };
        }
        return {
          pricingType: PricingType.FIXED,
          fixedPricingAmounts: amounts,
        };
      } catch {
        console.warn(
          `[sync/agents] Non-numeric source pricing amount for entry ${agentIdentifier}; storing as UNKNOWN`,
        );
        return { pricingType: PricingType.UNKNOWN };
      }
    }
    case "Free":
      return { pricingType: PricingType.FREE };
    default:
      return { pricingType: PricingType.UNKNOWN };
  }
}

/**
 * V2 entries price each payment source independently. The agent-level pricing
 * (credits math, availability) comes from the Cardano V2 source matching this
 * deployment's network; no match means the agent is not purchasable here.
 * Among matching sources, one that is currently purchase-ready is preferred so
 * the displayed price stays consistent with the source a hire can actually
 * use (readiness is refreshed just before registry sync in the same cron; a
 * readiness flip between syncs can still leave the stored price stale until
 * the entry next changes).
 */
function projectV2AgentPricing(
  entry: RegistryDiffEntry,
  readySources: readonly CardanoV2ReadySource[],
): ParsedAgentPricing {
  const network = getEnv().NETWORK;
  // Defensive `?? []`: the generated client does no runtime validation, so a
  // registry deployment predating the V2 surface must not crash the sync.
  const matching = (entry.SupportedPaymentSources ?? []).filter(
    (candidate) =>
      candidate.chain === "Cardano" &&
      candidate.network === network &&
      candidate.paymentSourceType === "Web3CardanoV2",
  );
  const source =
    matching.find((candidate) =>
      isCardanoV2SourceReady(
        entry.agentIdentifier,
        candidate.address,
        readySources,
      ),
    ) ?? matching[0];
  if (!source) {
    return { pricingType: PricingType.UNKNOWN };
  }
  return projectSourcePricing(source.pricing, entry.agentIdentifier);
}

function resolveEntryPricing(
  entry: RegistryDiffEntry,
  readySources: readonly CardanoV2ReadySource[],
): ParsedAgentPricing {
  // V2 pricing belongs to the registry policy/source model, not the legacy
  // top-level payment type. Free and EVM-only V2 entries report `None`.
  if (isV2RegistryIdentifier(entry.agentIdentifier)) {
    return projectV2AgentPricing(entry, readySources);
  }
  return parseEntryAgentPricing(entry.AgentPricing, entry.agentIdentifier);
}

interface AgentPaymentSourceRow {
  sourceIndex: number;
  chain: string;
  network: string;
  paymentSourceType: string | null;
  address: string;
  payTo: string | null;
  scheme: string | null;
  resource: string | null;
  pricingType: PricingType;
  amounts?: { unit: string; amount: bigint; decimals: number | null }[];
}

function buildPaymentSourceRows(
  entry: RegistryDiffEntry,
): AgentPaymentSourceRow[] {
  const rows: AgentPaymentSourceRow[] = [];
  const seenSourceIndexes = new Set<number>();
  for (const source of entry.SupportedPaymentSources ?? []) {
    // Defensive: sourceIndex is unique per agent in our schema; a duplicate
    // from the registry must not turn into a batch-stopping constraint error.
    if (seenSourceIndexes.has(source.sourceIndex)) {
      continue;
    }
    seenSourceIndexes.add(source.sourceIndex);

    const projected = projectSourcePricing(
      source.pricing,
      entry.agentIdentifier,
    );
    const row: AgentPaymentSourceRow = {
      sourceIndex: source.sourceIndex,
      chain: source.chain,
      network: source.network,
      paymentSourceType: source.paymentSourceType,
      address: source.address,
      payTo: source.payTo,
      scheme: source.scheme,
      resource: source.resource,
      pricingType: projected.pricingType,
    };
    if (
      projected.fixedPricingAmounts &&
      source.pricing.pricingType === "Fixed"
    ) {
      // Zip decimals positionally — assets are not guaranteed unique within
      // one source's fixed amounts.
      row.amounts = source.pricing.fixed.map((fixedAmount, index) => ({
        unit: fixedAmount.asset,
        amount:
          projected.fixedPricingAmounts?.[index]?.amount ??
          BigInt(fixedAmount.amount),
        decimals: fixedAmount.decimals ?? null,
      }));
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Registry-derived scalar fields, shared by create and update so re-registered
 * agents no longer go stale (the old update branch refreshed only uptime and
 * status).
 */
function buildRegistryAgentFields(
  entry: RegistryDiffEntry,
  version: RegistryAgentVersion,
) {
  return {
    name: entry.name,
    description: emptyStringToNull(entry.description),
    apiBaseUrl: emptyStringToNull(entry.apiBaseUrl),
    type: convertEntryType(entry.type),
    openApiSpecUrl: emptyStringToNull(entry.openApiSpecUrl),
    x402ResourcesUrl: emptyStringToNull(entry.x402ResourcesUrl),
    metadataVersion: entry.metadataVersion,
    supersededByAgentIdentifier: entry.supersededByAgentIdentifier,
    lastUptimeCheck: entry.lastUptimeCheck,
    uptimeCount: entry.uptimeCount,
    uptimeCheckCount: entry.uptimeCheckCount,
    capabilityName: emptyStringToNull(entry.Capability?.name),
    capabilityVersion: emptyStringToNull(entry.Capability?.version),
    authorName: emptyStringToNull(entry.authorName),
    authorContactEmail: isValidEmail(entry.authorContactEmail)
      ? entry.authorContactEmail
      : null,
    authorContactOther: emptyStringToNull(entry.authorContactOther),
    authorOrganization: emptyStringToNull(entry.authorOrganization),
    image: emptyStringToNull(entry.image),
    status: version.isValid ? convertStatus(entry.status) : AgentStatus.INVALID,
    legalOther: emptyStringToNull(entry.otherLegal),
    legalTerms: emptyStringToNull(entry.termsAndCondition),
    legalPrivacyPolicy: emptyStringToNull(entry.privacyPolicy),
    paymentType: convertPaymentType(entry.paymentType),
  };
}

function buildPaymentSourcesCreate(rows: AgentPaymentSourceRow[]) {
  return rows.map((row) => ({
    sourceIndex: row.sourceIndex,
    chain: row.chain,
    network: row.network,
    paymentSourceType: row.paymentSourceType,
    address: row.address,
    payTo: row.payTo,
    scheme: row.scheme,
    resource: row.resource,
    pricingType: row.pricingType,
    ...(row.amounts
      ? {
          amounts: {
            createMany: {
              data: row.amounts,
            },
          },
        }
      : {}),
  }));
}

/**
 * Replaces the pricing referenced by an existing AgentPricing row in place
 * (the Agent keeps its pricingId), cleaning up the previous fixed-pricing
 * rows.
 */
function isSameAgentPricing(
  current: {
    pricingType: PricingType;
    fixedPricing: { amounts: { unit: string; amount: bigint }[] } | null;
  },
  next: ParsedAgentPricing,
): boolean {
  if (current.pricingType !== next.pricingType) {
    return false;
  }
  const currentAmounts = current.fixedPricing?.amounts ?? [];
  const nextAmounts = next.fixedPricingAmounts ?? [];
  if (currentAmounts.length !== nextAmounts.length) {
    return false;
  }
  const toKey = (row: { unit: string; amount: bigint }) =>
    `${row.unit}:${row.amount}`;
  const sortedCurrent = currentAmounts.map(toKey).sort();
  const sortedNext = nextAmounts.map(toKey).sort();
  return sortedCurrent.every((value, index) => value === sortedNext[index]);
}

async function replaceAgentPricing(
  tx: Prisma.TransactionClient,
  pricingId: string,
  pricing: ParsedAgentPricing,
): Promise<void> {
  const current = await tx.agentPricing.findUnique({
    where: { id: pricingId },
    select: {
      pricingType: true,
      agentFixedPricingId: true,
      fixedPricing: {
        select: { amounts: { select: { unit: true, amount: true } } },
      },
    },
  });

  // Pricing is unchanged for the overwhelming majority of diff entries
  // (status/uptime updates) — skip the delete/recreate churn entirely.
  if (current && isSameAgentPricing(current, pricing)) {
    return;
  }

  await tx.agentPricing.update({
    where: { id: pricingId },
    data: {
      pricingType: pricing.pricingType,
      ...(current?.agentFixedPricingId
        ? { fixedPricing: { disconnect: true } }
        : {}),
    },
  });

  if (current?.agentFixedPricingId) {
    await tx.unitValue.deleteMany({
      where: { agentFixedPricingId: current.agentFixedPricingId },
    });
    await tx.agentFixedPricing.delete({
      where: { id: current.agentFixedPricingId },
    });
  }

  if (pricing.fixedPricingAmounts) {
    await tx.agentPricing.update({
      where: { id: pricingId },
      data: {
        fixedPricing: {
          create: {
            amounts: {
              createMany: {
                data: pricing.fixedPricingAmounts,
              },
            },
          },
        },
      },
    });
  }
}

/**
 * Moves user-owned relations from a duplicate Agent row onto the canonical
 * one before the duplicate is parked. Mirrors the consolidation in migration
 * 20260728090000: ratings keep the newest per user (the (userId, agentId)
 * unique constraint forbids duplicates), categories and any admin metadata
 * override follow the stable row, and job notifications are retargeted so
 * their deep links keep resolving.
 */
async function consolidateDuplicateAgentRelations(
  tx: Prisma.TransactionClient,
  duplicateAgentId: string,
  canonicalAgentId: string,
): Promise<void> {
  const [duplicateRatings, canonicalRatings] = await Promise.all([
    tx.userAgentRating.findMany({
      where: { agentId: duplicateAgentId },
      select: { id: true, userId: true, updatedAt: true },
    }),
    tx.userAgentRating.findMany({
      where: { agentId: canonicalAgentId },
      select: { id: true, userId: true, updatedAt: true },
    }),
  ]);
  const canonicalByUser = new Map(
    canonicalRatings.map((rating) => [rating.userId, rating]),
  );
  for (const rating of duplicateRatings) {
    const canonicalRating = canonicalByUser.get(rating.userId);
    if (!canonicalRating) {
      await tx.userAgentRating.update({
        where: { id: rating.id },
        data: { agentId: canonicalAgentId },
      });
      continue;
    }
    // The canonical row already holds this user's rating; keep the newer one.
    if (rating.updatedAt > canonicalRating.updatedAt) {
      await tx.userAgentRating.delete({ where: { id: canonicalRating.id } });
      await tx.userAgentRating.update({
        where: { id: rating.id },
        data: { agentId: canonicalAgentId },
      });
    } else {
      await tx.userAgentRating.delete({ where: { id: rating.id } });
    }
  }

  const duplicate = await tx.agent.findUnique({
    where: { id: duplicateAgentId },
    select: {
      categories: { select: { id: true } },
      metadataOverride: { select: { id: true } },
    },
  });
  if (duplicate?.categories.length) {
    await tx.agent.update({
      where: { id: canonicalAgentId },
      data: {
        categories: {
          connect: duplicate.categories.map((category) => ({
            id: category.id,
          })),
        },
      },
    });
  }
  if (duplicate?.metadataOverride) {
    const canonicalOverride = await tx.agentMetadataOverride.findUnique({
      where: { agentId: canonicalAgentId },
      select: { id: true },
    });
    // AgentMetadataOverride.agentId is unique: only move when free.
    if (!canonicalOverride) {
      await tx.agentMetadataOverride.update({
        where: { id: duplicate.metadataOverride.id },
        data: { agentId: canonicalAgentId },
      });
    }
  }
}

/**
 * Retargets job-notification deep links from a parked duplicate to the
 * canonical row. Runs OUTSIDE the park transaction on purpose: `metadata` is
 * an unindexed text column, so this is a sequential scan whose duration grows
 * with the notification table — inside the transaction it would eventually
 * exceed the timeout and roll back the park, wedging the sync cursor.
 * A failure here only leaves a stale deep link, so it is reported and
 * swallowed rather than retried into that wedge.
 *
 * The inner CASE (rather than a WHERE on pg_input_is_valid) keeps the jsonb
 * cast from ever being evaluated on malformed rows: PostgreSQL does not
 * guarantee WHERE-clause evaluation order.
 */
async function retargetDuplicateAgentNotifications(
  duplicateAgentId: string,
  canonicalAgentId: string,
): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE "notification"
      SET "metadata" = jsonb_set(
        "metadata"::jsonb,
        '{agentId}',
        to_jsonb(${canonicalAgentId}::text)
      )::text
      WHERE "id" IN (
        SELECT "id" FROM "notification"
        WHERE CASE
          WHEN "metadata" IS NULL THEN FALSE
          WHEN NOT pg_input_is_valid("metadata", 'jsonb') THEN FALSE
          ELSE "metadata"::jsonb ->> 'agentId' = ${duplicateAgentId}
        END
      )`;
  } catch (error) {
    console.warn(
      `[sync/agents] Failed to retarget notifications from ${duplicateAgentId} to ${canonicalAgentId}:`,
      error,
    );
    Sentry.captureException(error);
  }
}

interface CuratedTwinDefaults {
  categoryIds: string[];
  isShown: boolean;
  riskClassification: RiskClassification;
}

/**
 * Curation defaults for a newly discovered registry entry, inherited from an
 * existing row for the same agent under a DIFFERENT registry policy (the V1
 * twin of a seller who re-registered under V2). Admin decisions live on the
 * local row, not in the registry, so without this a V2 registration would
 * resurrect a suppressed agent and reset its risk rating.
 *
 * Suppression is inherited pessimistically: if ANY twin is hidden the new row
 * starts hidden. The admin metadata override is deliberately NOT moved — it
 * is unique per agent and still serves the twin.
 */
async function resolveCuratedTwinDefaults(
  entry: RegistryDiffEntry,
): Promise<CuratedTwinDefaults> {
  const fallback: CuratedTwinDefaults = {
    categoryIds: [],
    isShown: getEnv().SHOW_AGENTS_BY_DEFAULT,
    riskClassification: RiskClassification.MINIMAL,
  };
  if (!entry.apiBaseUrl || !entry.name) {
    return fallback;
  }

  try {
    const twins = await prisma.agent.findMany({
      where: {
        name: entry.name,
        apiBaseUrl: entry.apiBaseUrl,
        blockchainIdentifier: { not: entry.agentIdentifier },
      },
      select: {
        isShown: true,
        riskClassification: true,
        updatedAt: true,
        categories: { select: { id: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (twins.length === 0) {
      return fallback;
    }

    const newest = twins[0];
    return {
      categoryIds: newest.categories.map((category) => category.id),
      isShown: twins.every((twin) => twin.isShown) && fallback.isShown,
      riskClassification: newest.riskClassification,
    };
  } catch (error) {
    // Curation lookup must never break ingestion; fail to the safe default.
    console.warn(
      `[sync/agents] Failed to resolve curated twin for ${entry.agentIdentifier}; using defaults:`,
      error,
    );
    return fallback;
  }
}

async function upsertRegistryAgent(
  entry: RegistryDiffEntry,
  pricing: ParsedAgentPricing,
): Promise<void> {
  const version = resolveRegistryAgentVersion(entry);
  const registryFields = buildRegistryAgentFields(entry, version);
  const paymentSourceRows = buildPaymentSourceRows(entry);
  const tagReferences = (entry.tags ?? []).map((tag) => ({ name: tag }));
  const exampleOutputRows = (entry.ExampleOutput ?? []).map((example) => ({
    mimeType: example.mimeType,
    name: example.name,
    url: example.url,
  }));

  const existingAgentSelect = {
    id: true,
    pricingId: true,
    registryVersion: true,
    blockchainIdentifier: true,
    metadataVersion: true,
  } as const;
  const existingByRegistryIdentity = await prisma.agent.findUnique({
    where: { registryIdentity: version.registryIdentity },
    select: existingAgentSelect,
  });
  // A previous Core binary can insert V1 agents with registryIdentity=NULL
  // during rollback. Adopt that row by its legacy unique identifier when the
  // new release returns instead of colliding on blockchainIdentifier.
  const existing =
    existingByRegistryIdentity ??
    (isV2RegistryIdentifier(entry.agentIdentifier)
      ? await prisma.agent.findFirst({
          where: {
            blockchainIdentifier: {
              equals: entry.agentIdentifier,
              mode: "insensitive",
            },
          },
          select: existingAgentSelect,
        })
      : await prisma.agent.findUnique({
          where: { blockchainIdentifier: entry.agentIdentifier },
          select: existingAgentSelect,
        }));

  // A malformed V2 identifier keeps its FULL string as registryIdentity; if
  // that string happens to equal a valid agent's stripped identity, refuse to
  // overwrite the canonical row with malformed data (reachable only from a
  // corrupted registry response, never from honest chain data).
  if (
    !version.isValid &&
    existing &&
    existing.blockchainIdentifier !== entry.agentIdentifier
  ) {
    console.warn(
      `[sync/agents] Malformed V2 entry ${entry.agentIdentifier} collides with canonical identity ${version.registryIdentity}; skipping`,
    );
    return;
  }

  if (!existing) {
    // A seller re-registering under the V2 policy produces a BRAND NEW row
    // with no link to their existing one, so admin curation must be carried
    // across explicitly — otherwise turning the rollout flag on silently
    // re-publishes agents an admin suppressed and resets their risk rating.
    const curation = await resolveCuratedTwinDefaults(entry);
    await prisma.agent.create({
      data: {
        blockchainIdentifier: entry.agentIdentifier,
        registryIdentity: version.registryIdentity,
        registryVersion: version.registryVersion,
        ...registryFields,
        tags: { connect: tagReferences },
        ...(curation.categoryIds.length > 0
          ? {
              categories: {
                connect: curation.categoryIds.map((id) => ({ id })),
              },
            }
          : {}),
        riskClassification: curation.riskClassification,
        isShown: curation.isShown,
        pricing: {
          create: {
            pricingType: pricing.pricingType,
            ...(pricing.fixedPricingAmounts
              ? {
                  fixedPricing: {
                    create: {
                      amounts: {
                        createMany: {
                          data: pricing.fixedPricingAmounts,
                        },
                      },
                    },
                  },
                }
              : {}),
          },
        },
        paymentSources: {
          create: buildPaymentSourcesCreate(paymentSourceRows),
        },
        exampleOutput: {
          createMany: {
            data: exampleOutputRows,
          },
        },
      },
    });
    return;
  }

  if (version.registryVersion < existing.registryVersion) {
    return;
  }

  const isRevisionPromotion =
    version.registryVersion > existing.registryVersion;
  // Registry-owned collections and the generated summary also refresh when
  // the entry's metadataVersion moves without a revision promotion — V1
  // agents never promote (always version 0), so this is their only path to
  // shed stale examples and regenerate the summary after a metadata edit.
  const shouldReplaceCollections =
    isRevisionPromotion ||
    (entry.metadataVersion != null &&
      entry.metadataVersion !== existing.metadataVersion);

  // A rollback-era binary can also have stored this revision's identifier as
  // its OWN row (registryIdentity=NULL) while the canonical row resolved via
  // registryIdentity above. Park that duplicate before the canonical row
  // adopts the identifier, or the promotion update collides on
  // Agent_blockchainIdentifier_key on every retry (permanent cursor wedge).
  const conflictingByIdentifier =
    existing.blockchainIdentifier !== entry.agentIdentifier
      ? await prisma.agent.findFirst({
          where: {
            blockchainIdentifier: {
              equals: entry.agentIdentifier,
              mode: "insensitive",
            },
          },
          select: {
            id: true,
            blockchainIdentifier: true,
            apiBaseUrl: true,
            metadataOverride: { select: { apiBaseUrl: true } },
          },
        })
      : null;

  // Scalars refresh on every diff. A V2 revision promotion additionally
  // replaces registry-owned collections and invalidates the generated summary
  // so the stable Agent row never presents a mixture of two revisions.
  await prisma.$transaction(async (tx) => {
    if (conflictingByIdentifier && conflictingByIdentifier.id !== existing.id) {
      await tx.job.updateMany({
        where: {
          agentId: conflictingByIdentifier.id,
          agentBlockchainIdentifier: null,
        },
        data: {
          agentBlockchainIdentifier:
            conflictingByIdentifier.blockchainIdentifier,
        },
      });
      const duplicateApiBaseUrl =
        conflictingByIdentifier.metadataOverride?.apiBaseUrl ??
        conflictingByIdentifier.apiBaseUrl;
      if (duplicateApiBaseUrl) {
        await tx.job.updateMany({
          where: {
            agentId: conflictingByIdentifier.id,
            agentApiBaseUrl: null,
          },
          data: { agentApiBaseUrl: duplicateApiBaseUrl },
        });
      }
      await tx.job.updateMany({
        where: { agentId: conflictingByIdentifier.id },
        data: { agentId: existing.id },
      });

      // Consolidate the duplicate's user-owned relations onto the canonical
      // row before parking it, mirroring migration 20260728090000 — parking
      // alone would strand them on a hidden INVALID row. Registry-owned tags
      // are deliberately excluded: the canonical update below SETs them from
      // this entry, which is the authoritative list.
      await consolidateDuplicateAgentRelations(
        tx,
        conflictingByIdentifier.id,
        existing.id,
      );

      const parkedIdentifier = `legacy-v2:${conflictingByIdentifier.id}:${conflictingByIdentifier.blockchainIdentifier}`;
      await tx.agent.update({
        where: { id: conflictingByIdentifier.id },
        data: {
          blockchainIdentifier: parkedIdentifier,
          registryIdentity: parkedIdentifier,
          status: AgentStatus.INVALID,
          isShown: false,
        },
      });
    }
    await replaceAgentPricing(tx, existing.pricingId, pricing);
    await tx.agentPaymentSource.deleteMany({
      where: { agentId: existing.id },
    });
    if (shouldReplaceCollections) {
      await tx.exampleOutput.deleteMany({
        where: { agentId: existing.id },
      });
    }
    await tx.agent.update({
      where: { id: existing.id },
      data: {
        blockchainIdentifier: entry.agentIdentifier,
        registryIdentity: version.registryIdentity,
        registryVersion: version.registryVersion,
        ...registryFields,
        // Tags are registry-owned and every diff entry carries the full list,
        // so they are SET (not connected) on every update. This also heals
        // the historical tag unions the 20260728090000 repair left on
        // consolidated rows, which same-version replays could never remove.
        tags: { set: tagReferences },
        ...(shouldReplaceCollections
          ? {
              summary: null,
              ...(exampleOutputRows.length > 0
                ? {
                    exampleOutput: {
                      createMany: { data: exampleOutputRows },
                    },
                  }
                : {}),
            }
          : {}),
        paymentSources: {
          create: buildPaymentSourcesCreate(paymentSourceRows),
        },
      },
    });
  }, AGENT_UPSERT_TRANSACTION_OPTIONS);

  // Deep-link retargeting runs after the park commits — see the function's
  // note on why it must stay out of the transaction.
  if (conflictingByIdentifier && conflictingByIdentifier.id !== existing.id) {
    await retargetDuplicateAgentNotifications(
      conflictingByIdentifier.id,
      existing.id,
    );
  }
}

/**
 * Rollback fence: while the rollout flag is off, entries that would write
 * rows the PREVIOUS release's Prisma client cannot read (WEB3_CARDANO_V2 or
 * UNKNOWN enum values, NULL apiBaseUrl) are deferred. V2-enabled deployments
 * use their own sync cursor, so turning the flag on automatically replays the
 * registry without disturbing the rollback-safe V1 cursor.
 */
function isRollbackUnsafeEntry(entry: RegistryDiffEntry): boolean {
  return (
    (entry.paymentType !== "Web3CardanoV1" && entry.paymentType !== "None") ||
    !entry.apiBaseUrl ||
    convertEntryType(entry.type) !== AgentEntryType.STANDARD
  );
}

function shouldStopSync(
  options: SyncExecutionOptions,
  reason: string,
): boolean {
  if (options.abortSignal.aborted) {
    console.info(`Stopping sync operation: ${reason}`);
    return true;
  }

  if (!options.shouldContinue()) {
    console.info(`Stopping sync operation: ${reason}`);
    return true;
  }

  return false;
}

async function syncRegistryAgents(
  metadataKey: string,
  options: SyncExecutionOptions & { resetCursor?: boolean },
): Promise<void> {
  const startedAt = Date.now();
  const isCardanoV2Enabled = getEnv().ENABLE_CARDANO_V2_AGENTS;
  const activeMetadataKey = isCardanoV2Enabled
    ? `${metadataKey}${CARDANO_V2_SYNC_METADATA_SUFFIX}`
    : metadataKey;
  console.info(
    `[sync/agents] Starting registry sync (metadataKey=${activeMetadataKey})`,
  );

  if (
    shouldStopSync(options, "registry sync canceled before metadata lookup")
  ) {
    return;
  }

  if (options.resetCursor) {
    await prisma.syncMetadata.deleteMany({
      where: { key: activeMetadataKey },
    });
    console.info(
      "[sync/agents] Cursor reset requested — replaying the full registry diff",
    );
  }

  const metadata = await prisma.syncMetadata.findUnique({
    where: {
      key: activeMetadataKey,
    },
  });
  let lastSyncedAt = metadata?.lastSyncedAt ?? new Date(0);
  let cursorId = metadata?.cursorId ?? null;

  const deferV2Ingestion = !isCardanoV2Enabled;
  // Loaded once per run: readiness was refreshed immediately before this sync
  // (route ordering), and V2 pricing projection prefers purchase-ready
  // sources so listed prices match hireable sources.
  const cardanoV2ReadySources = await getCardanoV2ReadySources();
  let totalProcessedCount = 0;
  let totalDeferredCount = 0;
  let batchCount = 0;

  // Loop batches within the run's time budget (shouldStopSync consults the
  // handler deadline) instead of one 50-entry batch per cron run — a full
  // replay after /sync/agents/reset-cursor would otherwise freeze status
  // propagation for hours.
  while (true) {
    if (shouldStopSync(options, "registry sync canceled before diff request")) {
      return;
    }

    const entriesResult = await registryClient.getAgentsDiff(
      lastSyncedAt,
      cursorId,
      AGENT_SYNC_BATCH_SIZE,
      {
        signal: options.abortSignal,
      },
    );
    if (entriesResult.isErr()) {
      console.error(
        "[sync/agents] Error in diff sync operation:",
        entriesResult.error,
      );
      return;
    }

    const entries = entriesResult.value;
    if (entries.length === 0) {
      break;
    }
    batchCount++;

    const tags = Array.from(
      new Set(entries.map((entry) => entry.tags ?? []).flat()),
    );

    for (const tag of tags) {
      if (shouldStopSync(options, "registry sync canceled during tag upsert")) {
        return;
      }

      await prisma.tag.upsert({
        where: {
          name: tag,
        },
        create: {
          name: tag,
        },
        update: {},
      });
    }

    // Entries fully handled (upserted or deliberately deferred). The cursor
    // only advances past this contiguous prefix, so an unexpected error (e.g.
    // a transient DB failure) keeps retry semantics for the failed entry and
    // everything after it on the next run.
    let processedEntryCount = 0;
    let batchHadError = false;
    for (const entry of entries) {
      if (
        shouldStopSync(options, "registry sync canceled during agent upsert")
      ) {
        return;
      }

      // See isRollbackUnsafeEntry: V2/pointer/unknown entries are deferred
      // until the rollout flag turns ingestion on.
      if (deferV2Ingestion && isRollbackUnsafeEntry(entry)) {
        totalDeferredCount++;
        processedEntryCount++;
        continue;
      }

      try {
        const normalizedEntry = normalizeRegistryEntry(entry);
        const pricing = resolveEntryPricing(
          normalizedEntry,
          cardanoV2ReadySources,
        );
        await upsertRegistryAgent(normalizedEntry, pricing);
        processedEntryCount++;
      } catch (error) {
        // Failure (infra error, or a data shape the defensive parsing above
        // did not anticipate): stop the batch WITHOUT advancing the cursor
        // past this entry so the next run retries it. Transient errors
        // self-heal; a persistently failing entry keeps the cursor parked and
        // pages via Sentry rather than being silently dropped.
        console.error(
          `[sync/agents] Upsert failed for entry ${entry.agentIdentifier}; stopping batch for retry:`,
          error,
        );
        Sentry.captureException(error);
        batchHadError = true;
        break;
      }
    }

    if (
      shouldStopSync(options, "registry sync canceled before metadata update")
    ) {
      return;
    }

    if (processedEntryCount === 0) {
      console.warn(
        "[sync/agents] No entries processed; cursor not advanced (batch will be retried)",
      );
      return;
    }

    const lastEntry = entries[processedEntryCount - 1];
    await prisma.syncMetadata.upsert({
      where: {
        key: activeMetadataKey,
      },
      create: {
        key: activeMetadataKey,
        cursorId: lastEntry.id,
        lastSyncedAt: new Date(lastEntry.statusUpdatedAt),
      },
      update: {
        cursorId: lastEntry.id,
        lastSyncedAt: new Date(lastEntry.statusUpdatedAt),
      },
    });
    totalProcessedCount += processedEntryCount;

    if (batchHadError) {
      // Cursor is parked at the contiguous prefix; next run retries.
      return;
    }
    if (entries.length < AGENT_SYNC_BATCH_SIZE) {
      break;
    }
    lastSyncedAt = new Date(lastEntry.statusUpdatedAt);
    cursorId = lastEntry.id;
  }

  console.info(
    `[sync/agents] Completed registry sync (batches=${batchCount}, processed=${totalProcessedCount}, deferred=${totalDeferredCount}, durationMs=${Date.now() - startedAt})`,
  );
}

async function syncAgentSummaries(
  options: SyncExecutionOptions,
): Promise<void> {
  const startedAt = Date.now();
  console.info("[sync/agents-summary] Starting summary sync");

  if (shouldStopSync(options, "summary sync canceled before loading agents")) {
    return;
  }

  const agentsWithoutSummary = await prisma.agent.findMany({
    where: {
      status: AgentStatus.ONLINE,
      isShown: true,
      summary: null,
      OR: [
        { description: { not: null } },
        { metadataOverride: { description: { not: null } } },
      ],
    },
    include: {
      metadataOverride: true,
    },
    take: AGENT_SUMMARY_SYNC_LIMIT,
  });
  console.info(
    `[sync/agents-summary] Loaded candidates (count=${agentsWithoutSummary.length})`,
  );

  let updatedCount = 0;
  let skippedNoDescriptionCount = 0;
  let skippedNoSummaryCount = 0;
  let failedCount = 0;

  for (const agent of agentsWithoutSummary) {
    if (shouldStopSync(options, "summary sync canceled during agent loop")) {
      return;
    }

    const description = getAgentDescription(agent);
    if (!description) {
      skippedNoDescriptionCount++;
      continue;
    }

    try {
      const summary = await openrouterClient.generateAgentSummary(description, {
        abortSignal: options.abortSignal,
      });
      if (!summary) {
        skippedNoSummaryCount++;
        continue;
      }

      if (
        shouldStopSync(options, "summary sync canceled before summary write")
      ) {
        return;
      }

      await prisma.agent.update({
        where: {
          id: agent.id,
        },
        data: {
          summary,
        },
      });
      updatedCount++;
    } catch (error) {
      failedCount++;
      console.error(`Failed to generate summary for agent ${agent.id}:`, error);
    }
  }

  console.info(
    `[sync/agents-summary] Completed summary sync (updated=${updatedCount}, skippedNoDescription=${skippedNoDescriptionCount}, skippedNoSummary=${skippedNoSummaryCount}, failed=${failedCount}, durationMs=${Date.now() - startedAt})`,
  );
}

/**
 * Refreshes the cached Cardano V2 rail readiness of the payment node (read by
 * getCardanoV2ReadySources). On check failure the last known value is kept —
 * its TTL fails closed during an extended outage.
 */
async function syncCardanoV2RailReadiness(
  options: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const isCardanoV2Enabled = getEnv().ENABLE_CARDANO_V2_AGENTS;
  // Nothing reads the cache while the flag is off (isCardanoV2RailReady
  // short-circuits), so skip the node round-trip. After a flag flip the next
  // cron cycle populates the cache within 5 minutes.
  if (!isCardanoV2Enabled) {
    try {
      // Disabling the flag resets the Sentry dedupe latch so a re-enable
      // reports a fresh failure streak instead of inheriting an old marker.
      // Known trade-off: during a mixed-flag rollout a flag-off instance
      // wipes the latch every cycle, so a flag-on instance re-pages per cron
      // until the fleet converges — noise only, never a missed page.
      await prisma.syncMetadata.deleteMany({
        where: { key: CARDANO_V2_RAIL_READINESS_FAILURE_KEY },
      });
    } catch (cleanupError) {
      // Readiness bookkeeping must never crash the registry sync loop.
      console.warn(
        "[sync/agents] Failed to clear Cardano V2 readiness failure marker:",
        cleanupError,
      );
    }
    return false;
  }
  const readinessResult = await paymentClient().getCardanoV2RailReadiness({
    signal: options.signal,
  });

  if (readinessResult.isErr()) {
    console.warn(
      "[sync/agents] Cardano V2 rail readiness check failed:",
      readinessResult.error,
    );
    if (isCardanoV2Enabled) {
      try {
        // createMany + skipDuplicates is an atomic cross-instance latch:
        // exactly one serverless worker creates the marker and reports the
        // failure; later workers see count=0 until a successful check clears it.
        const marker = await prisma.syncMetadata.createMany({
          data: [
            {
              key: CARDANO_V2_RAIL_READINESS_FAILURE_KEY,
              cursorId: "failed",
              lastSyncedAt: new Date(),
            },
          ],
          skipDuplicates: true,
        });
        if (marker.count > 0) {
          Sentry.captureException(
            new Error(
              `Cardano V2 rail readiness check failed: ${readinessResult.error}`,
            ),
          );
        }
      } catch (markerError) {
        // Readiness is advisory and must never crash the registry sync loop.
        console.warn(
          "[sync/agents] Failed to persist Cardano V2 readiness failure marker:",
          markerError,
        );
      }
    }
    return false;
  }

  const readySources = [...readinessResult.value].sort((left, right) => {
    const policyComparison = left.policyId.localeCompare(right.policyId);
    return policyComparison !== 0
      ? policyComparison
      : left.smartContractAddress.localeCompare(right.smartContractAddress);
  });
  const serializedReadySources = JSON.stringify(readySources);
  const previousReadiness = await prisma.syncMetadata.findUnique({
    where: { key: CARDANO_V2_RAIL_READINESS_KEY },
  });
  const readinessChanged =
    previousReadiness?.cursorId !== serializedReadySources;
  await prisma.syncMetadata.upsert({
    where: { key: CARDANO_V2_RAIL_READINESS_KEY },
    create: {
      key: CARDANO_V2_RAIL_READINESS_KEY,
      cursorId: serializedReadySources,
      lastSyncedAt: new Date(),
    },
    update: {
      cursorId: serializedReadySources,
      lastSyncedAt: new Date(),
    },
  });
  await prisma.syncMetadata.deleteMany({
    where: { key: CARDANO_V2_RAIL_READINESS_FAILURE_KEY },
  });

  if (isCardanoV2Enabled && readySources.length === 0) {
    console.warn(
      "[sync/agents] No Cardano V2 source is purchase-ready; V2 agents stay unavailable despite ENABLE_CARDANO_V2_AGENTS",
    );
    // A successful check reporting ZERO ready sources hides the entire V2
    // catalog just as effectively as a failed check, so it must page too —
    // only report on the transition, so a lasting outage does not spam.
    if (readinessChanged) {
      Sentry.captureMessage(
        "Cardano V2 rail reports no purchase-ready source; all V2 agents are hidden",
        "error",
      );
    }
  }
  return readinessChanged;
}

export const agentSyncService = {
  syncRegistryAgents,
  syncAgentSummaries,
  syncCardanoV2RailReadiness,
};
