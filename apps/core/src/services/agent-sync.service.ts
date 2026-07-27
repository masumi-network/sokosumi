import { z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import {
  AgentEntryType,
  AgentStatus,
  PaymentType,
  PricingType,
  type Prisma,
} from "@sokosumi/database";
import { parseVersionedAgentIdentifier } from "@sokosumi/masumi";
import type { PostRegistryDiffResponse } from "@sokosumi/masumi/clients";

import { registryClient } from "@/clients/masumi-registry.client";
import { openrouterClient } from "@/clients/openrouter.client";
import { getEnv } from "@/config/env";
import { getAgentDescription } from "@/helpers/agent";
import prisma from "@/lib/db/prisma";

const AGENT_SUMMARY_SYNC_LIMIT = 20;

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
            unit: amount.unit,
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

interface RegistryAgentVersion {
  registryIdentity: string;
  registryVersion: number;
  isValid: boolean;
}

function resolveRegistryAgentVersion(
  entry: RegistryDiffEntry,
): RegistryAgentVersion {
  if (entry.paymentType !== "Web3CardanoV2") {
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
        // Units are stored verbatim, matching V1 ingestion — including the
        // registry's empty-string spelling for ADA/lovelace. Availability
        // still requires a CreditCost row for every unit.
        const amounts = pricing.fixed.map((fixedAmount) => ({
          unit: fixedAmount.asset,
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
 */
function projectV2AgentPricing(entry: RegistryDiffEntry): ParsedAgentPricing {
  const network = getEnv().NETWORK;
  // Defensive `?? []`: the generated client does no runtime validation, so a
  // registry deployment predating the V2 surface must not crash the sync.
  const source = (entry.SupportedPaymentSources ?? []).find(
    (candidate) =>
      candidate.chain === "Cardano" &&
      candidate.network === network &&
      candidate.paymentSourceType === "Web3CardanoV2",
  );
  if (!source) {
    return { pricingType: PricingType.UNKNOWN };
  }
  return projectSourcePricing(source.pricing, entry.agentIdentifier);
}

function resolveEntryPricing(entry: RegistryDiffEntry): ParsedAgentPricing {
  if (entry.paymentType === "Web3CardanoV2") {
    return projectV2AgentPricing(entry);
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
async function replaceAgentPricing(
  tx: Prisma.TransactionClient,
  pricingId: string,
  pricing: ParsedAgentPricing,
): Promise<void> {
  const current = await tx.agentPricing.findUnique({
    where: { id: pricingId },
    select: { agentFixedPricingId: true },
  });

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

async function upsertRegistryAgent(
  entry: RegistryDiffEntry,
  pricing: ParsedAgentPricing,
): Promise<void> {
  const version = resolveRegistryAgentVersion(entry);
  const registryFields = buildRegistryAgentFields(entry, version);
  const paymentSourceRows = buildPaymentSourceRows(entry);
  const tagsConnect = {
    connect: entry.tags?.map((tag) => ({
      name: tag,
    })),
  };

  const existing = await prisma.agent.findUnique({
    where: { registryIdentity: version.registryIdentity },
    select: { id: true, pricingId: true, registryVersion: true },
  });

  if (!existing) {
    await prisma.agent.create({
      data: {
        blockchainIdentifier: entry.agentIdentifier,
        registryIdentity: version.registryIdentity,
        registryVersion: version.registryVersion,
        ...registryFields,
        tags: tagsConnect,
        isShown: getEnv().SHOW_AGENTS_BY_DEFAULT,
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
            data: (entry.ExampleOutput ?? []).map((example) => ({
              mimeType: example.mimeType,
              name: example.name,
              url: example.url,
            })),
          },
        },
      },
    });
    return;
  }

  if (version.registryVersion < existing.registryVersion) {
    return;
  }

  // Full refresh of registry-derived data. Example outputs are deliberately
  // not refreshed (create-only, as before); tags accumulate via connect.
  await prisma.$transaction(async (tx) => {
    await replaceAgentPricing(tx, existing.pricingId, pricing);
    await tx.agentPaymentSource.deleteMany({
      where: { agentId: existing.id },
    });
    await tx.agent.update({
      where: { id: existing.id },
      data: {
        blockchainIdentifier: entry.agentIdentifier,
        registryVersion: version.registryVersion,
        ...registryFields,
        tags: tagsConnect,
        paymentSources: {
          create: buildPaymentSourcesCreate(paymentSourceRows),
        },
      },
    });
  });
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
  console.info(
    `[sync/agents] Starting registry sync (metadataKey=${metadataKey})`,
  );

  if (
    shouldStopSync(options, "registry sync canceled before metadata lookup")
  ) {
    return;
  }

  if (options.resetCursor) {
    await prisma.syncMetadata.deleteMany({
      where: { key: metadataKey },
    });
    console.info(
      "[sync/agents] Cursor reset requested — replaying the full registry diff",
    );
  }

  const metadata = await prisma.syncMetadata.findUnique({
    where: {
      key: metadataKey,
    },
  });
  const lastSyncedAt = metadata?.lastSyncedAt ?? new Date(0);
  const cursorId = metadata?.cursorId ?? null;

  if (shouldStopSync(options, "registry sync canceled before diff request")) {
    return;
  }

  const entriesResult = await registryClient.getAgentsDiff(
    lastSyncedAt,
    cursorId,
    50,
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
    console.info(
      `[sync/agents] No entries to sync (durationMs=${Date.now() - startedAt})`,
    );
    return;
  }

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

  // Entries fully handled (upserted or deliberately skipped). The cursor only
  // advances past this contiguous prefix, so an unexpected error (e.g. a
  // transient DB failure) keeps retry semantics for the failed entry and
  // everything after it on the next run.
  let processedEntryCount = 0;
  for (const entry of entries) {
    if (shouldStopSync(options, "registry sync canceled during agent upsert")) {
      return;
    }

    try {
      const pricing = resolveEntryPricing(entry);
      await upsertRegistryAgent(entry, pricing);
      processedEntryCount++;
    } catch (error) {
      // Failure (infra error, or a data shape the defensive parsing above
      // did not anticipate): stop the batch WITHOUT advancing the cursor past
      // this entry so the next run retries it. Transient errors self-heal; a
      // persistently failing entry keeps the cursor parked and pages via
      // Sentry rather than being silently dropped.
      console.error(
        `[sync/agents] Upsert failed for entry ${entry.agentIdentifier}; stopping batch for retry:`,
        error,
      );
      Sentry.captureException(error);
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
      key: metadataKey,
    },
    create: {
      key: metadataKey,
      cursorId: lastEntry.id,
      lastSyncedAt: new Date(lastEntry.statusUpdatedAt),
    },
    update: {
      cursorId: lastEntry.id,
      lastSyncedAt: new Date(lastEntry.statusUpdatedAt),
    },
  });

  console.info(
    `[sync/agents] Completed registry sync (entries=${entries.length}, processed=${processedEntryCount}, tags=${tags.length}, durationMs=${Date.now() - startedAt})`,
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

export const agentSyncService = {
  syncRegistryAgents,
  syncAgentSummaries,
};
