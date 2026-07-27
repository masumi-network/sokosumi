import { z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { AgentStatus, PaymentType, PricingType } from "@sokosumi/database";
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
  status: "Online" | "Offline" | "Deregistered" | "Invalid",
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
  }
}

function convertPaymentType(paymentType: "Web3CardanoV1" | "None" | unknown) {
  switch (paymentType) {
    case "Web3CardanoV1":
      return PaymentType.WEB3_CARDANO_V1;
    case "None":
      return PaymentType.NONE;
    default:
      return PaymentType.UNKNOWN;
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

function parseEntryAgentPricing(
  pricing: unknown,
  agentIdentifier: string,
): {
  pricingType: PricingType;
  fixedPricingAmounts?: { amount: bigint; unit: string }[];
} {
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

async function upsertRegistryAgent(
  entry: RegistryDiffEntry,
  apiBaseUrl: string,
  pricing: {
    pricingType: PricingType;
    fixedPricingAmounts?: { amount: bigint; unit: string }[];
  },
): Promise<void> {
  await prisma.agent.upsert({
    where: {
      blockchainIdentifier: entry.agentIdentifier,
    },
    create: {
      blockchainIdentifier: entry.agentIdentifier,
      name: entry.name,
      description: emptyStringToNull(entry.description),
      apiBaseUrl,
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
      image: emptyStringToNull(entry.image),
      tags: {
        connect: entry.tags?.map((tag) => ({
          name: tag,
        })),
      },
      authorOrganization: emptyStringToNull(entry.authorOrganization),
      isShown: getEnv().SHOW_AGENTS_BY_DEFAULT,
      status: convertStatus(entry.status),
      legalOther: emptyStringToNull(entry.otherLegal),
      legalTerms: emptyStringToNull(entry.termsAndCondition),
      legalPrivacyPolicy: emptyStringToNull(entry.privacyPolicy),
      paymentType: convertPaymentType(entry.paymentType),
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
    update: {
      lastUptimeCheck: entry.lastUptimeCheck,
      uptimeCount: entry.uptimeCount,
      uptimeCheckCount: entry.uptimeCheckCount,
      status: convertStatus(entry.status),
    },
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
  options: SyncExecutionOptions,
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

  let skippedEntryCount = 0;
  // Entries fully handled (upserted or deliberately skipped). The cursor only
  // advances past this contiguous prefix, so an unexpected error (e.g. a
  // transient DB failure) keeps retry semantics for the failed entry and
  // everything after it on the next run.
  let processedEntryCount = 0;
  for (const entry of entries) {
    if (shouldStopSync(options, "registry sync canceled during agent upsert")) {
      return;
    }

    // Deliberate deferral: only Web3CardanoV1/None entries are ingested for
    // now. V2 and pointer-type (OpenApi/X402) entries are skipped — ingesting
    // them needs schema support and, because the diff cursor advances past
    // them here, a one-off cursor reset/backfill when that support ships.
    // Entries with a missing/unrecognized paymentType land here too (skipped
    // instead of ingested as UNKNOWN placeholder rows).
    if (entry.paymentType !== "Web3CardanoV1" && entry.paymentType !== "None") {
      skippedEntryCount++;
      processedEntryCount++;
      continue;
    }

    // Entries without a MIP-003 endpoint cannot be hired and the Agent
    // apiBaseUrl column is non-nullable, so skip them.
    const apiBaseUrl = entry.apiBaseUrl;
    if (!apiBaseUrl) {
      skippedEntryCount++;
      processedEntryCount++;
      continue;
    }

    const { pricingType, fixedPricingAmounts } = parseEntryAgentPricing(
      entry.AgentPricing,
      entry.agentIdentifier,
    );

    try {
      await upsertRegistryAgent(entry, apiBaseUrl, {
        pricingType,
        fixedPricingAmounts,
      });
      processedEntryCount++;
    } catch (error) {
      // Unexpected failure (likely infra): stop the batch WITHOUT advancing
      // the cursor past this entry so the next run retries it. Structurally
      // bad entries cannot land here — the guards above degrade those to
      // skips — so this cannot reintroduce a crash loop on a known-bad batch.
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
    `[sync/agents] Completed registry sync (entries=${entries.length}, processed=${processedEntryCount}, skipped=${skippedEntryCount}, tags=${tags.length}, durationMs=${Date.now() - startedAt})`,
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
