import {
  AgentEntryType,
  AgentStatus,
  type CreditCost,
  PaymentType,
  PricingType,
  type Prisma,
} from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";
import {
  CAIP2_EVM_NETWORK_PATTERN,
  EVM_ADDRESS_PATTERN,
  listV2RegistryPolicyIds,
} from "@sokosumi/masumi";
import { getEnv } from "@/config/env";
import { listCardanoBillableUnitSpellings } from "@/helpers/agent-cost";
import { internalServerError, notFound } from "@/helpers/error";
import { isUsableAssetDecimals } from "@/helpers/x402-pricing";
import type { NetworkDb, NetworkScope, SharedDb } from "@/lib/db/network-scope";
import type { Network } from "@/lib/network";
import { readinessKey, readReadiness } from "./readiness";
import {
  getAllowedX402Caip2Networks,
  getTrustedX402ExactEvmDomain,
  getX402AgentCatalogWhere,
  hasValidX402DiscoveryUrl,
  isX402NetworkAllowed,
  trimEvmWalletId,
  type X402ReadySource,
} from "./x402";

// The old Preprod deployment also uses the Mainnet scope until ticket 22.
function deploymentRail() {
  return getEnv().NETWORK;
}

export function allowedX402ReadinessNetworks(_scope: NetworkScope) {
  return getAllowedX402Caip2Networks(deploymentRail());
}

/** Every rate of a Network, empty included: the one read of the rate table. */
export const readRates = (rates: NetworkDb["creditCost"]) => rates.findMany();

/**
 * Retrieves credit costs used for agent availability and pricing checks.
 * Throws when credit costs are missing because these checks depend on a configured unit table.
 */
export const getCreditCostsOrThrow = async (
  rates: NetworkDb["creditCost"],
): Promise<CreditCost[]> => {
  const creditCosts = await readRates(rates);
  if (creditCosts.length === 0) {
    throw internalServerError("Failed to get credit information for agents");
  }
  return creditCosts;
};

export interface CardanoV2ReadySource {
  policyId: string;
  smartContractAddress: string;
}

export function isCardanoV2SourceReady(
  agentIdentifier: string,
  smartContractAddress: string,
  readySources: readonly CardanoV2ReadySource[],
): boolean {
  const normalizedAgentIdentifier = agentIdentifier.toLowerCase();
  const normalizedSmartContractAddress = smartContractAddress.toLowerCase();
  return readySources.some(
    (source) =>
      normalizedAgentIdentifier.startsWith(source.policyId.toLowerCase()) &&
      source.smartContractAddress.toLowerCase() ===
        normalizedSmartContractAddress,
  );
}

/**
 * Isolation for any read that returns agent pricing.
 *
 * Prisma loads `include`d relations as SEPARATE statements — Agent, then
 * AgentPricing, then AgentFixedPricing, then UnitValue — and at PostgreSQL's
 * default READ COMMITTED every statement takes its own snapshot. A registry
 * replay rewrites pricing by deleting and recreating the amount rows, so a
 * replay committing between two of those statements leaves the reader holding
 * an AgentFixedPricing id whose UnitValue rows are already gone: FIXED pricing
 * with no amounts.
 *
 * That is not a partially visible transaction — READ COMMITTED never shows
 * one. It is read skew across the reader's own statements, so no change to the
 * write side can prevent it; only a shared snapshot can. REPEATABLE READ gives
 * the whole transaction one snapshot, and being read-only it cannot raise a
 * serialization failure, so it adds no error path.
 *
 * `calculateCentsFromPricingAmountRows` totals an empty amount set to zero, so
 * without this a catalog read can price a paid agent at zero credits.
 */
export const AGENT_PRICING_READ_TRANSACTION_OPTIONS = {
  isolationLevel: "RepeatableRead",
} as const;
const CARDANO_POLICY_ID_PATTERN = /^[0-9a-f]{56}$/;

/**
 * Exact Cardano V2 policy/contract sources the payment node last reported
 * purchase-ready. Returns an empty list when readiness has never been
 * recorded, when the recorded payload is unusable, and when the node last
 * reported nothing purchase-ready. Callers cannot tell those apart from the
 * result, and all three hide the entire V2 catalogue.
 *
 * Deliberately NOT expired on age. Readiness is static configuration — the
 * node derives it from config presence (an active source, a current contract,
 * an RPC key, admin wallets), never from balance or load — so a value that has
 * not been refreshed for a while is almost certainly still true. Expiring it
 * would mean our own cron falling behind takes the entire V2 catalog down,
 * which says nothing about whether V2 can actually settle. A node that truly
 * cannot settle rejects the purchase, and the outbox compensates.
 *
 * Read straight from the row on every call: it is a primary-key lookup, and a
 * process-local memo in front of it would only add staleness on top of the
 * cron's own lag while letting instances disagree with each other.
 */
function parseCardanoV2ReadySources(
  cursorId: string | null | undefined,
): CardanoV2ReadySource[] {
  if (!cursorId) {
    return [];
  }

  try {
    const payload: unknown = JSON.parse(cursorId);
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload.filter(
      (source): source is CardanoV2ReadySource =>
        typeof source === "object" &&
        source !== null &&
        "policyId" in source &&
        typeof source.policyId === "string" &&
        CARDANO_POLICY_ID_PATTERN.test(source.policyId) &&
        "smartContractAddress" in source &&
        typeof source.smartContractAddress === "string" &&
        source.smartContractAddress.length > 0,
    );
  } catch {
    return [];
  }
}

export const getCardanoV2ReadySources = async (
  tx: SharedDb,
  network: Network,
): Promise<CardanoV2ReadySource[]> => {
  const readiness = await readReadiness(tx, network, "cardanoV2");
  return parseCardanoV2ReadySources(readiness?.cursorId);
};

async function getCardanoV2ReadySourcesInTransaction(
  tx: NetworkDb,
  network: Network,
): Promise<CardanoV2ReadySource[]> {
  const key = readinessKey(network, "cardanoV2");
  const [readiness] = await tx.$queryRaw<{ cursorId: string | null }[]>`
    SELECT "cursorId"
    FROM ${sharedTable("sync_metadata")}
    WHERE "key" = ${key}
    LIMIT 1
  `;
  return parseCardanoV2ReadySources(readiness?.cursorId);
}

/**
 * Asserts that an agent exists and is available (ONLINE, shown, valid pricing),
 * throwing a 404 otherwise. Pass `tx` when running inside an open Network
 * transaction so readiness and agent reads stay on the same connection.
 */
export async function requireAvailableAgent(
  scope: NetworkScope,
  id: string,
  tx?: NetworkDb,
): Promise<void> {
  const db = tx ?? scope.networkDb;
  const creditCosts = await getCreditCostsOrThrow(db.creditCost);
  const cardanoV2ReadySources = tx
    ? await getCardanoV2ReadySourcesInTransaction(tx, scope.network)
    : await getCardanoV2ReadySources(scope.sharedDb, scope.network);

  const agent = await db.agent.findFirst({
    where: {
      id,
      ...buildAvailableAgentWhereClause(creditCosts, cardanoV2ReadySources),
    },
    select: { id: true },
  });

  if (!agent) {
    throw notFound("Agent not found");
  }
}

/**
 * Builds a Prisma where clause for filtering agents by availability and valid pricing.
 *
 * Availability rules:
 * - Only shows agents with status ONLINE and isShown: true
 *
 * Pricing validation rules:
 * - Exclude agents with pricingType UNKNOWN
 * - For FIXED pricing: require fixedPricing exists and has non-empty amounts
 * - For FIXED pricing: ensure all amount units exist in CreditCost table
 * - FREE pricing is always valid (no additional validation needed)
 *
 * @param creditCosts - Array of credit costs to validate pricing units against
 * @returns Prisma where clause for agent queries
 */
export const buildAvailableAgentWhereClause = (
  creditCosts: CreditCost[],
  cardanoV2ReadySources: readonly CardanoV2ReadySource[],
): Prisma.AgentWhereInput => {
  // Both spellings of every billable unit; CAIP-19 rows are excluded — they
  // price per whole token and must never make a Cardano-convention agent
  // billable (see listCardanoBillableUnitSpellings).
  const validUnits = listCardanoBillableUnitSpellings(creditCosts);
  // V2 availability is gated on rail readiness alone: the payment node must
  // have recently reported at least one purchase-ready Cardano V2 source.
  // That is the gate that actually reflects whether a V2 hire can settle — a
  // static boolean could only ever agree with it by coincidence.
  const isCardanoV2Enabled = cardanoV2ReadySources.length > 0;

  const pricingFilter = {
    pricingType: { not: PricingType.UNKNOWN },
    OR: [
      { pricingType: PricingType.FREE },
      {
        pricingType: PricingType.FIXED,
        fixedPricing: {
          amounts: {
            every: {
              unit: { in: validUnits },
            },
            // `every` is vacuously true for an empty relation, so without this
            // a FIXED pricing whose amount rows are momentarily gone (a
            // registry replay deletes and recreates them) still matches. Such
            // an agent throws in getAgentCost and is dropped from the page by
            // buildAgentSummaries — excluding it here keeps the row set and
            // the total count in agreement.
            some: {
              unit: { in: validUnits },
            },
          },
        },
      },
    ],
  };

  // "Is a V2 agent" — by declared payment type OR by membership of the V2
  // registry policy. The union matters in both directions: free and EVM-only
  // V2 entries report paymentType "None", while an entry can declare
  // Web3CardanoV2 under some other policy id. Either alone is fail-open.
  const v2AgentFilter = {
    OR: [
      { paymentType: PaymentType.WEB3_CARDANO_V2 },
      ...listV2RegistryPolicyIds().map((policyId) => ({
        blockchainIdentifier: { startsWith: policyId },
      })),
    ],
  };

  return {
    status: AgentStatus.ONLINE,
    isShown: true,
    // Only Standard entries with a MIP-003 endpoint can be hired; OpenApi and
    // X402 pointer entries have no job flow yet.
    type: AgentEntryType.STANDARD,
    // Allowlist of payment rails the job flow can actually purchase through.
    // UNKNOWN (unrecognized future rails) is always excluded; V2 requires an
    // exact policy/contract source that the payment node recently reported
    // purchase-ready (see getCardanoV2ReadySources). Wallet funding is not
    // covered and stays a runbook step.
    paymentType: {
      in: [
        PaymentType.WEB3_CARDANO_V1,
        PaymentType.NONE,
        ...(isCardanoV2Enabled ? [PaymentType.WEB3_CARDANO_V2] : []),
      ],
    },
    // A metadata override can supply the endpoint when the registry entry
    // has none.
    AND: [
      {
        OR: [
          { apiBaseUrl: { not: null } },
          { metadataOverride: { apiBaseUrl: { not: null } } },
        ],
      },
      // Membership of the V2 registry policy — NOT the payment type — decides
      // whether the V2 rules apply: free and EVM-only V2 agents report
      // paymentType "None" and would otherwise skip the purchase-ready
      // requirement entirely (mirrors isV2RegistryIdentifier).
      isCardanoV2Enabled
        ? {
            OR: [
              { NOT: v2AgentFilter },
              ...cardanoV2ReadySources.map((source) => ({
                blockchainIdentifier: {
                  startsWith: source.policyId,
                },
                paymentSources: {
                  some: {
                    chain: "Cardano",
                    network: deploymentRail(),
                    paymentSourceType: "Web3CardanoV2",
                    // Exact match on purpose. Prisma's `mode: "insensitive"`
                    // compiles to ILIKE with the value as an unescaped
                    // pattern, so `_` in a bech32 address (every testnet one
                    // contains "addr_test1") becomes a wildcard — pattern
                    // matching is the wrong tool for a purchase-readiness
                    // gate. Cardano bech32 is lowercase by specification and
                    // ingestion normalizes V2 identifiers, so exact equality
                    // is correct; isCardanoV2SourceReady stays defensive for
                    // the runtime path where the value is compared in JS.
                    address: source.smartContractAddress,
                  },
                },
              })),
            ],
          }
        : { NOT: v2AgentFilter },
    ],
    pricing: pricingFilter,
  };
};

/**
 * Exact (network, asset) pairs the payment node last reported buy-side ready.
 * Empty means never recorded, the payload is unusable, OR a successful check
 * found nothing ready — those three are indistinguishable to callers.
 * Listing and pay treat empty as fail-closed.
 *
 * Deliberately NOT expired on age, mirroring `getCardanoV2ReadySources`:
 * readiness is configuration plus funded-wallet presence, refreshed by the sync
 * cron; a value that has not been refreshed for a while is almost certainly
 * still true, and expiring it would let our own cron falling behind take the
 * entire x402 listing down. A node that truly cannot pay refuses the sign,
 * and the sign-failure path refunds synchronously (provably unpaid).
 *
 * Read straight from the row on every call — a primary-key lookup; a
 * process-local memo would only add staleness while letting instances
 * disagree with each other.
 *
 * The per-environment allowlist is applied again here, behind the
 * compose-time filter in `composeX402ReadySources`: a row written by an older
 * build — or by an instance pointed at the other environment — must not serve
 * a mainnet pair to a Preprod deployment. Re-filtering on read costs an array
 * pass and removes the cache as a trusted input.
 */
export const x402ReadySources = async (
  scope: NetworkScope,
  tx: SharedDb = scope.sharedDb,
): Promise<X402ReadySource[]> => {
  const readiness = await readReadiness(tx, scope.network, "x402");
  if (!readiness?.cursorId) {
    return [];
  }

  const environment = deploymentRail();
  try {
    const payload: unknown = JSON.parse(readiness.cursorId);
    if (!Array.isArray(payload)) {
      return [];
    }
    const canonicalSources = payload
      .filter(
        (source): source is X402ReadySource =>
          typeof source === "object" &&
          source !== null &&
          "caip2Network" in source &&
          typeof source.caip2Network === "string" &&
          CAIP2_EVM_NETWORK_PATTERN.test(source.caip2Network) &&
          isX402NetworkAllowed(source.caip2Network, environment) &&
          "asset" in source &&
          typeof source.asset === "string" &&
          EVM_ADDRESS_PATTERN.test(source.asset) &&
          // Old builds could cache any node-default ERC-20. Pay now accepts
          // only pairs with locally trusted EIP-712 domain metadata, so the
          // read path must apply the same filter or listing would advertise
          // an agent whose payment route always fails closed.
          getTrustedX402ExactEvmDomain(source.caip2Network, source.asset) !==
            null &&
          // A pair without its backing wallet cannot be signed with — a row
          // cached before the evmWalletId field existed is unusable and drops
          // until the next sync rewrites the cache.
          "evmWalletId" in source &&
          typeof source.evmWalletId === "string" &&
          trimEvmWalletId(source.evmWalletId) !== undefined &&
          // The signed payer must later match the exact wallet whose
          // balances made this pair ready. Old cache rows without the
          // expected address cannot establish that binding and fail closed.
          "evmWalletAddress" in source &&
          typeof source.evmWalletAddress === "string" &&
          EVM_ADDRESS_PATTERN.test(source.evmWalletAddress) &&
          // Same treatment for the node-published decimals, and for the same
          // reason the other fields are re-validated here: the cache is not a
          // trusted input. A row written before this field existed — or one
          // carrying a non-integer or out-of-range value — has no usable
          // scale, and pricing off a wrong scale is a 10^n mischarge. Drop
          // the pair until the next sync rewrites the cache; NEVER fall back
          // to the agent-registered decimals.
          "decimals" in source &&
          isUsableAssetDecimals(source.decimals),
      )
      // Emit the canonical pair rather than the row as stored.
      // EVM_ADDRESS_PATTERN accepts mixed case, so a legacy or hand-edited
      // row would be VALIDATED in one spelling and RETURNED in another —
      // the same validate-one / forward-another split the 402 normalizer
      // closed. Everything downstream compares canonical lowercase
      // (`findX402ReadySource`, `buildCaip19AssetKey`, and the pay call's
      // `preferredAsset`, where a mismatch would miss the node lookup AFTER
      // the credits are charged). `composeX402ReadySources` writes lowercase
      // today, so this only bites a legacy row — which is exactly why the
      // read must not trust the cache. Extra cached properties are dropped
      // for the same reason: only the fields `X402ReadySource` declares are
      // served.
      .map((source) => ({
        caip2Network: source.caip2Network.trim().toLowerCase(),
        asset: source.asset.trim().toLowerCase(),
        evmWalletId: source.evmWalletId.trim(),
        evmWalletAddress: source.evmWalletAddress.trim().toLowerCase(),
        decimals: source.decimals,
      }));
    // `composeX402ReadySources` keys its output on the canonical
    // (network, asset), so a healthy cache can never repeat a pair — but the
    // cache is not a trusted input (see above), and `findX402ReadySource`
    // returns the FIRST match, so a hand-edited or legacy row that duplicates
    // a pair would let array order pick the signer wallet and the charge
    // scale. Mirror the compose-side rule: an exact repeat collapses to one
    // row; a disagreeing repeat poisons the pair (neither spelling is served).
    const sourcesByPair = new Map<string, X402ReadySource | null>();
    for (const source of canonicalSources) {
      const key = `${source.caip2Network}:${source.asset}`;
      const recorded = sourcesByPair.get(key);
      if (recorded === undefined) {
        sourcesByPair.set(key, source);
        continue;
      }
      if (
        recorded === null ||
        recorded.evmWalletId !== source.evmWalletId ||
        recorded.evmWalletAddress !== source.evmWalletAddress ||
        recorded.decimals !== source.decimals
      ) {
        sourcesByPair.set(key, null);
      }
    }
    return [...sourcesByPair.values()].filter(
      (source): source is X402ReadySource => source !== null,
    );
  } catch {
    return [];
  }
};

// The default charge transaction still has Network delegates on today's public layout.
// After the split SharedDb cannot read these models. Ticket 29 moves the payment
// rows and decides how to read this catalog on the charge's connection.
type CatalogChargeTransaction = Prisma.TransactionClient;

export function requireRates(
  scope: NetworkScope,
  tx?: CatalogChargeTransaction,
) {
  return getCreditCostsOrThrow((tx ?? scope.networkDb).creditCost);
}

export function cardanoV2ReadySources(
  scope: NetworkScope,
  tx: SharedDb = scope.sharedDb,
) {
  return getCardanoV2ReadySources(tx, scope.network);
}

/**
 * The listed x402 agent for a payable id, or null. Same environment-aware SQL
 * gates as the listing: type and status everywhere, plus curation on Mainnet.
 * Preprod intentionally permits hidden online entries; offline entries never
 * remain payable through a remembered id. The charge transaction supplies
 * the Agent table until ticket 29 can select it by scope.
 */
export async function findListedX402Agent(
  _scope: NetworkScope,
  agentId: string,
  tx: CatalogChargeTransaction,
) {
  const network = deploymentRail();
  const agent = await tx.agent.findFirst({
    where: {
      id: agentId,
      ...getX402AgentCatalogWhere(network),
    },
    include: {
      paymentSources: {
        // The normalized demand is always `exact`, but registry source data is
        // independent. Keep unsupported signing contracts out so an agent
        // hidden by the listing cannot still be paid through a remembered id.
        where: {
          scheme: { not: null },
        },
        include: {
          // Both relations are explicitly ordered, mirroring the listing
          // query. Unordered, Prisma returns Postgres heap order, so the
          // matcher's `find` — "the first amount row for this asset" — could
          // resolve to a different row here than the one the listing
          // advertised a price for. Ingestion deliberately permits duplicate
          // units within one source, so identical ordering on both sides is
          // what makes listing and pay agree on row identity; a unique on
          // (paymentSourceId, unit) would instead break the sync.
          amounts: { orderBy: [{ unit: "asc" }, { id: "asc" }] },
        },
        orderBy: { sourceIndex: "asc" },
      },
    },
  });
  return agent && hasValidX402DiscoveryUrl(agent) ? { agent, network } : null;
}

export async function readListingInputs(
  scope: NetworkScope,
  includeCardano: boolean,
  includeX402: boolean,
) {
  const [creditCosts, cardanoV2ReadySources, readySources] = await Promise.all([
    readRates(scope.networkDb.creditCost),
    includeCardano
      ? getCardanoV2ReadySources(scope.sharedDb, scope.network)
      : Promise.resolve([]),
    includeX402 ? x402ReadySources(scope) : Promise.resolve([]),
  ]);
  // Masumi configuration per Network is ticket 22.
  const network = deploymentRail();

  return { creditCosts, cardanoV2ReadySources, readySources, network };
}
