import * as Sentry from "@sentry/node";
import {
  AgentEntryType,
  AgentStatus,
  type Prisma,
  RiskClassification,
} from "@sokosumi/database";
import {
  isV2RegistryIdentifier,
  normalizeMasumiPaymentUnit,
} from "@sokosumi/masumi";

import { registryClient } from "@/clients/masumi-registry.client";
import { openrouterClient } from "@/clients/openrouter.client";
import { getEnv } from "@/config/env";
import { getAgentDescription, getCardanoV2ReadySources } from "@/helpers/agent";
import prisma from "@/lib/db/prisma";

import {
  consolidateDuplicateAgentRelations,
  PARKED_IDENTIFIER_PREFIX,
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

interface SyncExecutionOptions {
  abortSignal: AbortSignal;
  shouldContinue: () => boolean;
}

/**
 * Ids of Agent rows whose `blockchainIdentifier` equals `agentIdentifier`
 * case-insensitively. The casing genuinely can differ: a rollback-era binary
 * stored the registry's spelling verbatim, while this release normalizes V2
 * identifiers to lowercase, and the registry may serve either over time.
 *
 * Deliberately NOT Prisma's `mode: "insensitive"`. On PostgreSQL that compiles
 * to ILIKE with the value used as an UNESCAPED PATTERN, so a `%` or `_` in a
 * registry-supplied identifier would match unrelated agents — and one caller
 * below writes `status: INVALID`, another adopts a row as canonical. `lower()`
 * on both sides is a plain equality test with no pattern semantics, and the
 * value stays a bound parameter. Same reasoning as the exact-match comment in
 * `buildAvailableAgentWhereClause`.
 *
 * The scan is unindexed, which is fine at catalog scale (a few thousand rows);
 * add a `lower("blockchainIdentifier")` functional index if Agent ever grows
 * by an order of magnitude.
 */
async function findAgentIdsByIdentifierCaseInsensitive(
  agentIdentifier: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Agent"
    WHERE lower("blockchainIdentifier") = lower(${agentIdentifier})`;
  return rows.map((row) => row.id);
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
  const identifierMatchIds =
    await findAgentIdsByIdentifierCaseInsensitive(agentIdentifier);

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
        ...(identifierMatchIds.length > 0
          ? [{ id: { in: identifierMatchIds } }]
          : []),
      ],
    },
    data: { status: AgentStatus.INVALID },
  });
}

/** Stable, comparable rendering of a pricing set for the reprice audit log. */
function formatPricingForAudit(
  pricingType: string,
  amounts: readonly { unit: string; amount: bigint }[] | undefined,
): string {
  if (!amounts || amounts.length === 0) {
    return pricingType;
  }
  const rendered = [...amounts]
    .map((entry) => `${entry.amount}${entry.unit || "lovelace"}`)
    .sort()
    .join("+");
  return `${pricingType}:${rendered}`;
}

/**
 * Records that a registry sync changed a live agent's price.
 *
 * A seller edits their registry entry and the next sync makes the new price
 * authoritative for every subsequent hire, with no admin in the loop. That is
 * intended — the registry owns the price — but it must not be invisible: the
 * first replay after this release repoints every agent whose registry price
 * drifted from the value frozen at its original ingestion, and without a
 * record there is nothing to reconcile a support question against.
 *
 * Already-charged work is unaffected. Credits are debited from the price read
 * at hire time, refunds reverse the stored transaction amount, and job sync
 * reconciles against the job's own `purchaseAmounts` snapshot — none of them
 * re-read agent pricing. This log is the audit trail for FUTURE hires only.
 */
function reportAgentRepricing(
  agentIdentifier: string,
  previous: string,
  next: string,
): void {
  console.warn("[sync/agents] Registry pricing changed for a live agent", {
    agentIdentifier,
    previousPricing: previous,
    nextPricing: next,
  });
  Sentry.captureMessage("Registry pricing changed for a live agent", {
    level: "info",
    tags: { error_type: "agent_repriced" },
    extra: { agentIdentifier, previousPricing: previous, nextPricing: next },
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
  agentIdentifier: string,
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

  // Past this point the price genuinely differs. `current` is null only when
  // the row is being populated for the first time, which is not a reprice.
  if (current) {
    reportAgentRepricing(
      agentIdentifier,
      formatPricingForAudit(current.pricingType, current.fixedPricing?.amounts),
      formatPricingForAudit(pricing.pricingType, pricing.fixedPricingAmounts),
    );
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
    apiBaseUrl: true,
    isShown: true,
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
            id: {
              in: await findAgentIdsByIdentifierCaseInsensitive(
                entry.agentIdentifier,
              ),
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
    // A new registry identity is a NEW AGENT. No curation is inferred from
    // any existing row — not visibility, not risk, not categories.
    //
    // The only link available between a re-registration and its predecessor is
    // name + apiBaseUrl, and both are registry-controlled free text. That
    // cannot distinguish "the same seller re-registering under V2" from
    // "someone cloning a popular agent's name and endpoint", in EITHER
    // direction: inheriting from a clone that registered first would stamp an
    // impostor's suppression and risk rating onto the genuine seller's later
    // registration. Since the signal cannot tell the two apart, it is not used.
    //
    // The cost is that an admin re-reviews a re-registered agent. That is the
    // correct place for the decision — a human who can actually tell whether
    // this is the same product.
    await prisma.agent.create({
      data: {
        blockchainIdentifier: entry.agentIdentifier,
        registryIdentity: version.registryIdentity,
        registryVersion: version.registryVersion,
        ...registryFields,
        tags: { connect: tagReferences },
        riskClassification: RiskClassification.MINIMAL,
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

  // A promotion rewrites the canonical row — endpoint, pricing, payment
  // sources — while the ratings, categories and risk rating of the previous
  // revision stay attached. Core cannot verify locally that the successor was
  // minted by the same seller: that guarantee lives in the V2 registry
  // validator. So when a promotion MOVES THE ENDPOINT, unpublish the row and
  // page instead of letting the new endpoint inherit a curated, well-rated
  // listing. In-flight jobs are unaffected (they pin their own endpoint
  // snapshot via `toMasumiAgentForJob`); an admin re-publishes after review.
  const promotedEndpoint =
    isRevisionPromotion &&
    registryFields.apiBaseUrl !== existing.apiBaseUrl &&
    // A revision that merely ADDS an endpoint to a pointer entry has nothing
    // curated to hijack — there was no reachable agent before.
    existing.apiBaseUrl !== null;

  if (promotedEndpoint && existing.isShown) {
    Sentry.captureMessage(
      "Agent revision promotion changed the API endpoint; unpublishing pending review",
      {
        level: "error",
        tags: { error_type: "agent_revision_endpoint_changed" },
        extra: {
          agentId: existing.id,
          registryIdentity: version.registryIdentity,
          fromVersion: existing.registryVersion,
          toVersion: version.registryVersion,
          previousApiBaseUrl: existing.apiBaseUrl,
          nextApiBaseUrl: registryFields.apiBaseUrl,
        },
      },
    );
  }

  // A rollback-era binary can also have stored this revision's identifier as
  // its OWN row (registryIdentity=NULL) while the canonical row resolved via
  // registryIdentity above. Park that duplicate before the canonical row
  // adopts the identifier, or the promotion update collides on
  // Agent_blockchainIdentifier_key on every retry (permanent cursor wedge).
  // The canonical row is excluded from the candidates: it can itself match
  // case-insensitively (it holds this identifier in a different casing, which
  // is what got us past the guard above), and `findFirst` has no ordering — so
  // leaving it in lets the query return the canonical row while a genuine
  // duplicate goes unparked, and the promotion below then collides on
  // Agent_blockchainIdentifier_key exactly as this block exists to prevent.
  const conflictingByIdentifier =
    existing.blockchainIdentifier !== entry.agentIdentifier
      ? await prisma.agent.findFirst({
          where: {
            id: {
              in: (
                await findAgentIdsByIdentifierCaseInsensitive(
                  entry.agentIdentifier,
                )
              ).filter((agentId) => agentId !== existing.id),
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
      const movedJobs = await tx.job.updateMany({
        where: { agentId: conflictingByIdentifier.id },
        data: { agentId: existing.id },
      });
      // Agent.jobCount is denormalized — it backs the public execution count
      // and the default `jobCount DESC` catalog order, and its only other
      // writer increments on job creation. Moving Job rows without moving the
      // counter would leave the canonical agent undercounting every hire it
      // just inherited, and ranking below agents it has actually outsold.
      //
      // All jobs leave the duplicate, so its counter is zero — set absolute 0
      // rather than decrementing. A floored decrement still risks undershoot
      // if the denormalized value was already below the real job count; zero
      // matches the post-move truth and cannot go negative.
      if (movedJobs.count > 0) {
        await tx.agent.update({
          where: { id: existing.id },
          data: { jobCount: { increment: movedJobs.count } },
        });
        await tx.agent.update({
          where: { id: conflictingByIdentifier.id },
          data: { jobCount: 0 },
        });
      }

      // Consolidate the duplicate's user-owned relations onto the canonical
      // row before parking it, mirroring migration 20260805132000 — parking
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
    await replaceAgentPricing(
      tx,
      existing.pricingId,
      pricing,
      entry.agentIdentifier,
    );
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
        // See `promotedEndpoint`: an endpoint move across a revision cannot be
        // verified as same-seller here, so the listing stops being hireable
        // until an admin re-publishes it.
        ...(promotedEndpoint ? { isShown: false } : {}),
        // Tags are registry-owned and every diff entry carries the full list,
        // so they are SET (not connected) on every update. This also heals
        // the historical tag unions the 20260805132000 repair left on
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

/**
 * Rollback fence: an entry whose row the PREVIOUS release cannot read.
 *
 * This branch adds `WEB3_CARDANO_V2` to `Agent.paymentType` and drops NOT NULL
 * from `Agent.apiBaseUrl`. The previous release's Prisma enum is
 * `WEB3_CARDANO_V1 | NONE | UNKNOWN`, so it throws on any row carrying the new
 * value — writing one turns a binary rollback from "redeploy" into "redeploy
 * after rewriting rows".
 *
 * Keyed on rail readiness rather than on a flag, because readiness is already
 * the go-live signal: the catalogue gates on it, and a readiness transition
 * resets the sync cursor (routes/sync/agents/get.ts), so everything deferred
 * here is replayed in full the first time the node reports a purchase-ready
 * source. The rollback window therefore closes at go-live, not at the first
 * cron tick after deploy.
 *
 * Nothing user-visible is withheld: `buildAvailableAgentWhereClause` already
 * requires `type: STANDARD`, an endpoint, and — for V2 — a ready source, so
 * every entry deferred here would have been hidden from the catalogue anyway.
 */
function isRollbackUnsafeEntry(entry: RegistryDiffEntry): boolean {
  return (
    (entry.paymentType !== "Web3CardanoV1" && entry.paymentType !== "None") ||
    // Free and EVM-only V2 entries report paymentType "None", so payment type
    // alone would let them through the fence. Membership of the V2 registry
    // policy is the authoritative test, exactly as it is for versioning.
    isV2RegistryIdentifier(entry.agentIdentifier) ||
    !entry.apiBaseUrl ||
    convertEntryType(entry.type) !== AgentEntryType.STANDARD
  );
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
  let lastSyncedAt = metadata?.lastSyncedAt ?? new Date(0);
  let cursorId = metadata?.cursorId ?? null;

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
  let totalQuarantinedCount = 0;
  let totalDeferredCount = 0;
  // Closed by the first readiness success, which also resets the cursor and
  // replays everything deferred while it was open.
  const deferRollbackUnsafeEntries = cardanoV2ReadySources.length === 0;
  let batchCount = 0;

  // Loop batches within the run's time budget (shouldStopSync consults the
  // handler deadline) instead of one 50-entry batch per cron run — the full
  // replay that follows a cursor reset would otherwise freeze status
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
        // See isRollbackUnsafeEntry. Deferred, not failed: the cursor advances
        // past it, and the readiness transition that lifts the fence resets
        // the cursor so the whole registry is replayed with the fence open.
        if (deferRollbackUnsafeEntries && isRollbackUnsafeEntry(entry)) {
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
        key: metadataKey,
      },
      create: {
        key: metadataKey,
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
    `[sync/agents] Completed registry sync (batches=${batchCount}, processed=${totalProcessedCount}, quarantined=${totalQuarantinedCount}, deferred=${totalDeferredCount}, durationMs=${Date.now() - startedAt})`,
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
