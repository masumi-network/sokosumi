import * as Sentry from "@sentry/node";
import {
  AgentEntryType,
  AgentStatus,
  RiskClassification,
} from "@sokosumi/database";
import {
  isV2RegistryIdentifier,
  normalizeMasumiPaymentUnit,
} from "@sokosumi/masumi";
import { createError } from "evlog";
import type { registryClient } from "@/clients/masumi-registry.client";
import type { openrouterClient } from "@/clients/openrouter.client";
import { getEnv } from "@/config/env";
import { getAgentDescription } from "@/helpers/agent";
import { cardanoV2ReadySources } from "@/lib/agent-catalog/availability";
import type { NetworkDb, NetworkScope } from "@/lib/db/network-scope";
import {
  createCoreLogger,
  emitCoreError,
  emitCoreWarning,
  logCoreWarning,
} from "@/lib/evlog";
import { networkKey } from "@/lib/network";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { getEnvSecrets, redactSecrets } from "@/lib/secret-redaction";

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
import { evaluateRevisionExposureGuard } from "./agent-sync.revision-guard.js";

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

const REGISTRY_SYNC_OPERATION = "agent_registry_sync";
const SUMMARY_SYNC_OPERATION = "agent_summary_sync";
const REGISTRY_ENTRY_FIX =
  "The registry owner must fix the entry; the next agents sync reads it again once it changes.";
const REGISTRY_ENTRY_UNSTORABLE =
  "The registry entry has a value Core cannot store";

/** Where a run stopped early, for its summary event; null when it did not. */
interface SyncRunStop {
  stopped: string | null;
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
  scope: NetworkScope,
  agentIdentifier: string,
): Promise<string[]> {
  const rows = await scope.networkDb.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM ${scope.networkTable("Agent")}
    WHERE lower("blockchainIdentifier") = lower(${agentIdentifier})`;
  return rows.map((row) => row.id);
}

async function quarantineInvalidRegistryEntry(
  scope: NetworkScope,
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
    emitCoreError(
      // Where the entry is invalid is detail, so a field.
      { operation: REGISTRY_SYNC_OPERATION, registryIssue: issue },
      {
        message:
          "Could not quarantine a registry entry that cannot be stored, because it has no agent identifier",
        why: REGISTRY_ENTRY_UNSTORABLE,
        fix: `${REGISTRY_ENTRY_FIX} Sentry has the rejected entry.`,
      },
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
  emitCoreError(
    {
      operation: REGISTRY_SYNC_OPERATION,
      agent: { identifier: normalizedEntry.agentIdentifier },
      registryIssue: issue,
    },
    {
      message:
        "Quarantined a registry entry that cannot be stored; its agent is marked invalid",
      why: REGISTRY_ENTRY_UNSTORABLE,
      fix: REGISTRY_ENTRY_FIX,
    },
  );
  const identifierMatchIds = await findAgentIdsByIdentifierCaseInsensitive(
    scope,
    agentIdentifier,
  );

  // Invalidate only this revision or an older canonical row. Preserve
  // administrator visibility choice: a later corrected registry entry can
  // restore status, but must never silently re-enable a hidden agent.
  await scope.networkDb.agent.updateMany({
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
  // Routine and intended, so info: the record, not an alarm.
  createCoreLogger({
    operation: REGISTRY_SYNC_OPERATION,
    agent: { identifier: agentIdentifier },
    agentRepricing: { previous, next },
  }).emit();
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
  tx: NetworkDb,
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
  scope: NetworkScope,
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
    type: true,
    x402ResourcesUrl: true,
    openApiSpecUrl: true,
    isShown: true,
  } as const;
  const existingByRegistryIdentity = await scope.networkDb.agent.findUnique({
    where: { registryIdentity: version.registryIdentity },
    select: existingAgentSelect,
  });
  // A previous Core binary can insert V1 agents with registryIdentity=NULL
  // during rollback. Adopt that row by its legacy unique identifier when the
  // new release returns instead of colliding on blockchainIdentifier.
  const existing =
    existingByRegistryIdentity ??
    (isV2RegistryIdentifier(entry.agentIdentifier)
      ? await scope.networkDb.agent.findFirst({
          where: {
            id: {
              in: await findAgentIdsByIdentifierCaseInsensitive(
                scope,
                entry.agentIdentifier,
              ),
            },
          },
          select: existingAgentSelect,
        })
      : await scope.networkDb.agent.findUnique({
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
    emitCoreWarning(
      {
        operation: REGISTRY_SYNC_OPERATION,
        agent: {
          identifier: entry.agentIdentifier,
          registryIdentity: version.registryIdentity,
        },
      },
      {
        message:
          "Skipped a malformed V2 registry entry that collides with an existing agent",
        why: "Its version suffix is invalid, and its full identifier equals another agent's registry identity",
        fix: REGISTRY_ENTRY_FIX,
      },
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
    await scope.networkDb.agent.create({
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

  // Curated exposure must not survive a change of the surface it was granted
  // for: a promoted endpoint move, or any move of a pointer entry's
  // discovery identity (entry type / discovery URL). The guard pages and the
  // update below writes `isShown: false`; an admin re-publishes after review.
  const unpublishForRevisionExposure = evaluateRevisionExposureGuard({
    existing,
    incomingFields: registryFields,
    registryIdentity: version.registryIdentity,
    incomingRegistryVersion: version.registryVersion,
  });

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
      ? await scope.networkDb.agent.findFirst({
          where: {
            id: {
              in: (
                await findAgentIdsByIdentifierCaseInsensitive(
                  scope,
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
  await scope.netTransactionOnce(async (tx) => {
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
        // See `evaluateRevisionExposureGuard`: an endpoint or discovery-
        // identity move cannot be verified as same-seller here, so the
        // listing stops being exposed until an admin re-publishes it.
        ...(unpublishForRevisionExposure ? { isShown: false } : {}),
        // Tags are registry-owned and every diff entry carries the full list,
        // so they are SET (not connected) on every update. This also heals
        // the historical tag unions the 20260805132000 repair left on
        // consolidated rows, which same-version replays could never remove.
        tags: { set: tagReferences },
        ...(shouldReplaceCollections
          ? {
              summary: null,
              summaryDeclinedAt: null,
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
      scope.sharedDb,
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
  run: SyncRunStop,
  reason: string,
): boolean {
  if (options.abortSignal.aborted || !options.shouldContinue()) {
    run.stopped = reason;
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

interface RegistrySyncRun extends SyncRunStop {
  metadataKey: string;
  cursorReset: boolean;
  batches: number;
  processed: number;
  quarantined: number;
  deferred: number;
}

type CoreLogger = ReturnType<typeof createCoreLogger>;

/**
 * Runs after the agents cron response, so the run is one standalone event:
 * its counts, where it stopped early, and the failure that ended it.
 */
async function syncRegistryAgents(
  scope: NetworkScope,
  registry: Pick<typeof registryClient, "getAgentsDiff">,
  metadataKey: string,
  options: SyncExecutionOptions & { resetCursor?: boolean },
): Promise<void> {
  const run: RegistrySyncRun = {
    metadataKey: networkKey(scope.network, metadataKey),
    cursorReset: false,
    batches: 0,
    processed: 0,
    quarantined: 0,
    deferred: 0,
    stopped: null,
  };
  const log = createCoreLogger({ operation: REGISTRY_SYNC_OPERATION });
  try {
    await runRegistrySync(scope, registry, options, run, log);
  } finally {
    log.set({ agentRegistrySync: run });
    log.emit();
  }
}

async function runRegistrySync(
  scope: NetworkScope,
  registry: Pick<typeof registryClient, "getAgentsDiff">,
  options: SyncExecutionOptions & { resetCursor?: boolean },
  run: RegistrySyncRun,
  log: CoreLogger,
): Promise<void> {
  const { metadataKey } = run;
  if (
    shouldStopSync(
      options,
      run,
      "registry sync canceled before metadata lookup",
    )
  ) {
    return;
  }

  if (options.resetCursor) {
    await scope.sharedDb.syncMetadata.deleteMany({
      where: { key: metadataKey },
    });
    // Cursor reset requested — replaying the full registry diff.
    run.cursorReset = true;
  }

  const metadata = await scope.sharedDb.syncMetadata.findUnique({
    where: {
      key: metadataKey,
    },
  });
  let lastSyncedAt = metadata?.lastSyncedAt ?? new Date(0);
  let cursorId = metadata?.cursorId ?? null;

  // Loaded once per run: readiness was refreshed immediately before this sync
  // (route ordering), and V2 pricing projection prefers purchase-ready
  // sources so listed prices match hireable sources.
  const readySources = await cardanoV2ReadySources(scope);
  // Units Sokosumi can convert to credits, for the advisory unbillable-source
  // check below. Normalized so "" / "lovelace" compare as one unit, matching
  // how projectSourcePricing stores them.
  const creditCostUnits = new Set(
    (await scope.networkDb.creditCost.findMany({ select: { unit: true } })).map(
      (creditCost) => normalizeMasumiPaymentUnit(creditCost.unit),
    ),
  );
  // Closed by the first readiness success, which also resets the cursor and
  // replays everything deferred while it was open.
  const deferRollbackUnsafeEntries = readySources.length === 0;

  // Loop batches within the run's time budget (shouldStopSync consults the
  // handler deadline) instead of one 50-entry batch per cron run — the full
  // replay that follows a cursor reset would otherwise freeze status
  // propagation for hours.
  while (true) {
    if (
      shouldStopSync(options, run, "registry sync canceled before diff request")
    ) {
      return;
    }

    const entriesResult = await registry.getAgentsDiff(
      lastSyncedAt,
      cursorId,
      AGENT_SYNC_BATCH_SIZE,
      {
        signal: options.abortSignal,
      },
    );
    if (entriesResult.isErr()) {
      // The registry client caps this string, but its content is still the
      // far side's, and a proxy that echoes request headers would put
      // REGISTRY_API_KEY inside it. Sentry redacts in `beforeSend`; stdout
      // has no such hook.
      log.error(
        createError({
          message: "Could not read the agent registry diff",
          why: "The registry did not return the agent diff",
          cause: new Error(redactSecrets(entriesResult.error, getEnvSecrets())),
          fix: "The next agents sync retries from the same cursor. If it fails every run, check the registry service and REGISTRY_API_KEY.",
        }),
      );
      return;
    }

    const entries = entriesResult.value;
    if (entries.length === 0) {
      break;
    }
    run.batches++;

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
      if (
        shouldStopSync(options, run, "registry sync canceled during tag upsert")
      ) {
        return;
      }

      await scope.networkDb.tag.upsert({
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
        shouldStopSync(
          options,
          run,
          "registry sync canceled during agent upsert",
        )
      ) {
        return;
      }

      const entryCursor = getRegistryEntryCursor(entry);
      if (!entryCursor) {
        log.error(
          createError({
            message:
              "A registry entry has invalid cursor fields, so the batch stopped for a retry",
            why: "Its id or statusUpdatedAt is missing or invalid, and advancing past it could skip later registry changes",
            fix: "The next agents sync retries the batch. If it stops here every run, the registry must fix the entry.",
          }),
          {
            agent: { identifier: getRegistryEntryLogIdentifier(entry) },
          },
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
          await quarantineInvalidRegistryEntry(scope, entry, storageIssue);
          run.quarantined++;
          processedEntryCount++;
          lastProcessedCursor = entryCursor;
          continue;
        }
        // See isRollbackUnsafeEntry. Deferred, not failed: the cursor advances
        // past it, and the readiness transition that lifts the fence resets
        // the cursor so the whole registry is replayed with the fence open.
        if (deferRollbackUnsafeEntries && isRollbackUnsafeEntry(entry)) {
          run.deferred++;
          processedEntryCount++;
          lastProcessedCursor = entryCursor;
          continue;
        }
        const normalizedEntry = normalizeRegistryEntry(entry);
        const pricing = resolveEntryPricing(
          scope,
          normalizedEntry,
          readySources,
        );
        warnOnUnbillableReadyV2Sources(
          scope,
          normalizedEntry,
          readySources,
          creditCostUnits,
        );
        await upsertRegistryAgent(scope, normalizedEntry, pricing);
        processedEntryCount++;
        lastProcessedCursor = entryCursor;
      } catch (error) {
        // Failure (infra error, or a data shape the defensive parsing above
        // did not anticipate): stop the batch WITHOUT advancing the cursor
        // past this entry so the next run retries it. Transient errors
        // self-heal; a persistently failing entry keeps the cursor parked and
        // pages via Sentry rather than being silently dropped.
        log.error(
          createError({
            message:
              "Could not save an agent from the registry, so the batch stopped for a retry",
            why: "The database write of the agent failed",
            fix: "The next agents sync retries this entry. If it fails every run, read error.cause and fix the entry's data or the database error.",
            cause: error instanceof Error ? error : undefined,
          }),
          {
            agent: { identifier: getRegistryEntryLogIdentifier(entry) },
          },
        );
        Sentry.captureException(error);
        batchHadError = true;
        break;
      }
    }

    if (
      shouldStopSync(
        options,
        run,
        "registry sync canceled before metadata update",
      )
    ) {
      return;
    }

    if (processedEntryCount === 0 || lastProcessedCursor === null) {
      logCoreWarning(log, {
        message:
          "The agents sync processed no registry entry, so its cursor did not move",
        why: "The batch stopped at its first entry",
        fix: "The next agents sync retries the batch; the error on this event says why it stopped.",
      });
      return;
    }

    await scope.sharedDb.syncMetadata.upsert({
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
    run.processed += processedEntryCount;

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
}

interface SummarySyncRun extends SyncRunStop {
  candidates: number;
  updated: number;
  skippedNoDescription: number;
  skippedNoSummary: number;
  declined: number;
  failed: number;
}

/** Runs after the agents-summary cron response: one standalone event per run. */
async function syncAgentSummaries(
  scope: NetworkScope,
  model: Pick<typeof openrouterClient, "generateAgentSummary">,
  options: SyncExecutionOptions,
): Promise<void> {
  const run: SummarySyncRun = {
    candidates: 0,
    updated: 0,
    skippedNoDescription: 0,
    skippedNoSummary: 0,
    declined: 0,
    failed: 0,
    stopped: null,
  };
  // Created before the run, so the event's duration covers it.
  const log = createCoreLogger({ operation: SUMMARY_SYNC_OPERATION });
  try {
    await runSummarySync(scope, model, options, run);
  } finally {
    log.set({ agentSummarySync: run });
    log.emit();
  }
}

async function runSummarySync(
  scope: NetworkScope,
  model: Pick<typeof openrouterClient, "generateAgentSummary">,
  options: SyncExecutionOptions,
  run: SummarySyncRun,
): Promise<void> {
  if (
    shouldStopSync(options, run, "summary sync canceled before loading agents")
  ) {
    return;
  }

  const agentsWithoutSummary = await scope.networkDb.agent.findMany({
    where: {
      status: AgentStatus.ONLINE,
      isShown: true,
      summary: null,
      summaryDeclinedAt: null,
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
  run.candidates = agentsWithoutSummary.length;

  for (const agent of agentsWithoutSummary) {
    if (
      shouldStopSync(options, run, "summary sync canceled during agent loop")
    ) {
      return;
    }

    const description = getAgentDescription(agent);
    if (!description) {
      run.skippedNoDescription++;
      continue;
    }

    try {
      const result = await model.generateAgentSummary(description, {
        abortSignal: options.abortSignal,
      });
      if (!result) {
        run.skippedNoSummary++;
        continue;
      }

      if (
        shouldStopSync(
          options,
          run,
          "summary sync canceled before summary write",
        )
      ) {
        return;
      }

      // A decline is stored so the Agent leaves this candidate set; otherwise
      // it is picked again every run and can crowd out the rest of the batch.
      await scope.networkDb.agent.update({
        where: {
          id: agent.id,
        },
        data:
          result.kind === "summary"
            ? { summary: result.text }
            : // A decline changes nothing a viewer sees; keep the public
              // `updatedAt` where it was.
              { summaryDeclinedAt: new Date(), updatedAt: agent.updatedAt },
      });
      if (result.kind === "declined") {
        run.declined++;
        continue;
      }
      run.updated++;
    } catch (error) {
      run.failed++;
      // The AI call's error can quote the description and the update's the
      // summary, so only the error's shape is logged.
      emitCoreError(
        {
          operation: SUMMARY_SYNC_OPERATION,
          agent: { id: agent.id },
          failure: messageSafeErrorFields(error),
        },
        {
          message: "Could not generate a summary for an agent",
          why: "Generating or saving the summary failed",
          fix: "The next agents-summary sync tries this agent again. If it fails every run, look up the error name and code under failure.",
        },
      );
    }
  }
}

export const agentSyncService = {
  syncRegistryAgents,
  syncAgentSummaries,
  syncCardanoV2RailReadiness,
};
