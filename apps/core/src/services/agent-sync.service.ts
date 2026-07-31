import * as Sentry from "@sentry/node";
import { AgentEntryType, AgentStatus, type Prisma } from "@sokosumi/database";
import { isV2RegistryIdentifier } from "@sokosumi/masumi";

import { registryClient } from "@/clients/masumi-registry.client";
import { openrouterClient } from "@/clients/openrouter.client";
import { getEnv } from "@/config/env";
import {
  getAgentDescription,
  getCardanoV2ReadySources,
  normalizeMasumiPaymentUnit,
} from "@/helpers/agent";
import prisma from "@/lib/db/prisma";

import {
  consolidateDuplicateAgentRelations,
  PARKED_IDENTIFIER_PREFIX,
  resolveCuratedTwinDefaults,
  retargetDuplicateAgentNotifications,
} from "./agent-sync.consolidation.js";
import {
  buildPaymentSourceRows,
  buildPaymentSourcesCreate,
  buildRegistryAgentFields,
  convertEntryType,
  getRegistryEntryCursor,
  getRegistryEntryStorageIssue,
  isSameAgentPricing,
  normalizeRegistryEntry,
  type ParsedAgentPricing,
  type RegistryDiffEntry,
  type RegistryEntryCursor,
  resolveEntryPricing,
  resolveRegistryAgentVersion,
  warnOnUnbillableReadyV2Sources,
} from "./agent-sync.projection.js";
import { syncCardanoV2RailReadiness } from "./agent-sync.readiness.js";

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

async function quarantineInvalidRegistryEntry(
  entry: RegistryDiffEntry,
  issue: string,
): Promise<void> {
  // Do not run the full normalizer here: this path exists precisely because a
  // nested registry value may be null or malformed. Only the identifier is
  // needed to quarantine the matching local revision.
  const agentIdentifier: unknown = entry.agentIdentifier;
  Sentry.captureMessage("Registry entry rejected before database persistence", {
    level: "error",
    tags: { error_type: "invalid_registry_entry" },
    extra: {
      agentIdentifier,
      issue,
    },
  });
  if (typeof agentIdentifier !== "string" || agentIdentifier.length === 0) {
    console.error(
      `[sync/agents] Cannot quarantine registry entry without a valid agentIdentifier: ${issue}`,
    );
    return;
  }
  const normalizedEntry = {
    ...entry,
    agentIdentifier: isV2RegistryIdentifier(agentIdentifier)
      ? agentIdentifier.toLowerCase()
      : agentIdentifier,
  };
  const version = resolveRegistryAgentVersion(normalizedEntry);
  console.error(
    `[sync/agents] Quarantining registry entry ${normalizedEntry.agentIdentifier}: ${issue}`,
  );

  // Invalidate only this revision or an older canonical row. Preserve
  // administrator visibility choice: a later corrected registry entry can
  // restore status, but must never silently re-enable a hidden agent.
  await prisma.agent.updateMany({
    where: {
      OR: [
        ...(version.isValid
          ? [
              {
                registryIdentity: version.registryIdentity,
                registryVersion: { lte: version.registryVersion },
              },
            ]
          : []),
        { blockchainIdentifier: normalizedEntry.agentIdentifier },
      ],
    },
    data: { status: AgentStatus.INVALID },
  });
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
      // row before parking it, mirroring migration 20260730152000 — parking
      // alone would strand them on a hidden INVALID row. Registry-owned tags
      // are deliberately excluded: the canonical update below SETs them from
      // this entry, which is the authoritative list.
      await consolidateDuplicateAgentRelations(
        tx,
        conflictingByIdentifier.id,
        existing.id,
      );

      const parkedIdentifier = `${PARKED_IDENTIFIER_PREFIX}${conflictingByIdentifier.id}:${conflictingByIdentifier.blockchainIdentifier}`;
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
        // the historical tag unions the 20260730152000 repair left on
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
    // Free and EVM-only V2 entries report paymentType "None", so the payment
    // type alone would let them through the fence and onto the marketplace
    // before the rollout flag is ever enabled. Membership of the V2 registry
    // policy is the authoritative test, exactly as it is for versioning.
    isV2RegistryIdentifier(entry.agentIdentifier) ||
    !entry.apiBaseUrl ||
    convertEntryType(entry.type) !== AgentEntryType.STANDARD
  );
}

function getRegistryEntryLogIdentifier(entry: unknown): string {
  if (
    typeof entry === "object" &&
    entry !== null &&
    "agentIdentifier" in entry &&
    typeof entry.agentIdentifier === "string"
  ) {
    return entry.agentIdentifier;
  }
  return "<unknown>";
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
  // Units Sokosumi can convert to credits, for the advisory unbillable-source
  // check below. Normalized so "" / "lovelace" compare as one unit, matching
  // how projectSourcePricing stores them.
  const creditCostUnits = new Set(
    (await prisma.creditCost.findMany({ select: { unit: true } })).map(
      (creditCost) => normalizeMasumiPaymentUnit(creditCost.unit),
    ),
  );
  let totalProcessedCount = 0;
  let totalDeferredCount = 0;
  let totalQuarantinedCount = 0;
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

    // Validate every registry-controlled value that fans out into bounded
    // Prisma columns before any batch writes. Schema-invalid entries are
    // quarantined and counted as processed; only infrastructure failures park
    // the cursor for retry.
    const storageIssues = entries.map(getRegistryEntryStorageIssue);

    const tags = Array.from(
      new Set(
        entries
          .filter((_entry, index) => storageIssues[index] === null)
          .map((entry) => entry.tags ?? [])
          .flat(),
      ),
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
    let lastProcessedCursor: RegistryEntryCursor | null = null;
    for (const [entryIndex, entry] of entries.entries()) {
      if (
        shouldStopSync(options, "registry sync canceled during agent upsert")
      ) {
        return;
      }

      const entryCursor = getRegistryEntryCursor(entry);
      if (!entryCursor) {
        console.error(
          "[sync/agents] Registry entry has invalid cursor fields; stopping batch for retry",
        );
        Sentry.captureMessage("Registry entry has invalid cursor fields", {
          level: "error",
          tags: { error_type: "invalid_registry_cursor" },
        });
        batchHadError = true;
        break;
      }

      try {
        const storageIssue = storageIssues[entryIndex];
        if (storageIssue) {
          await quarantineInvalidRegistryEntry(entry, storageIssue);
          totalQuarantinedCount++;
          processedEntryCount++;
          lastProcessedCursor = entryCursor;
          continue;
        }
        // See isRollbackUnsafeEntry: V2/pointer/unknown entries are deferred
        // until the rollout flag turns ingestion on.
        if (deferV2Ingestion && isRollbackUnsafeEntry(entry)) {
          totalDeferredCount++;
          processedEntryCount++;
          lastProcessedCursor = entryCursor;
          continue;
        }
        const normalizedEntry = normalizeRegistryEntry(entry);
        const pricing = resolveEntryPricing(
          normalizedEntry,
          cardanoV2ReadySources,
        );
        warnOnUnbillableReadyV2Sources(
          normalizedEntry,
          cardanoV2ReadySources,
          creditCostUnits,
        );
        await upsertRegistryAgent(normalizedEntry, pricing);
        processedEntryCount++;
        lastProcessedCursor = entryCursor;
      } catch (error) {
        // Failure (infra error, or a data shape the defensive parsing above
        // did not anticipate): stop the batch WITHOUT advancing the cursor
        // past this entry so the next run retries it. Transient errors
        // self-heal; a persistently failing entry keeps the cursor parked and
        // pages via Sentry rather than being silently dropped.
        console.error(
          `[sync/agents] Upsert failed for entry ${getRegistryEntryLogIdentifier(entry)}; stopping batch for retry:`,
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

    if (processedEntryCount === 0 || lastProcessedCursor === null) {
      console.warn(
        "[sync/agents] No entries processed; cursor not advanced (batch will be retried)",
      );
      return;
    }

    await prisma.syncMetadata.upsert({
      where: {
        key: activeMetadataKey,
      },
      create: {
        key: activeMetadataKey,
        cursorId: lastProcessedCursor.id,
        lastSyncedAt: lastProcessedCursor.statusUpdatedAt,
      },
      update: {
        cursorId: lastProcessedCursor.id,
        lastSyncedAt: lastProcessedCursor.statusUpdatedAt,
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
    lastSyncedAt = lastProcessedCursor.statusUpdatedAt;
    cursorId = lastProcessedCursor.id;
  }

  console.info(
    `[sync/agents] Completed registry sync (batches=${batchCount}, processed=${totalProcessedCount}, deferred=${totalDeferredCount}, quarantined=${totalQuarantinedCount}, durationMs=${Date.now() - startedAt})`,
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
  syncCardanoV2RailReadiness,
};
