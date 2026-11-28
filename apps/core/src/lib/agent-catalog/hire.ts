import {
  agentMetadataOverrideScalarsInclude,
  agentPricingInclude,
  type CreditCost,
  PaymentType,
  PricingType,
} from "@sokosumi/database";
import {
  isV2RegistryIdentifier,
  normalizeMasumiPaymentUnit,
} from "@sokosumi/masumi";
import {
  calculateCentsFromMasumiAmountStrings,
  getAgentCost,
} from "@/helpers/agent-cost";
import { badRequest, notFound, unprocessableEntity } from "@/helpers/error";
import type { NetworkScope } from "@/lib/db/network-scope";
import {
  AGENT_PRICING_READ_TRANSACTION_OPTIONS,
  buildAvailableAgentWhereClause,
  type CardanoV2ReadySource,
  cardanoV2PaymentSourcesOnRail,
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
  isCardanoV2SourceReady,
} from "./availability";

export const MAX_PAYMENT_NODE_PURCHASE_AMOUNTS = 7;

/**
 * The Agent a hire may buy, its price in cents, the rates it was priced with,
 * the ready sources it was admitted with and, for a paid V2 Agent, the
 * purchase-ready sources it may settle through, by source index. Throws the
 * 404 for an Agent that cannot be hired, the 400 when the price exceeds
 * `maxCents`, and the 422 when no ready V2 source can be billed.
 */
export async function requireAgentForHire(
  scope: NetworkScope,
  id: string,
  maxCents: bigint | null,
) {
  const creditCosts = await getCreditCostsOrThrow(scope.networkDb.creditCost);
  const cardanoV2ReadySources = await getCardanoV2ReadySources(
    scope.sharedDb,
    scope.network,
  );

  // Price and payment sources must come from ONE snapshot: they are separate
  // statements, and a registry replay landing between them would price this
  // hire from an amount set that no longer exists. See
  // AGENT_PRICING_READ_TRANSACTION_OPTIONS. The current Prisma adapter elides
  // BEGIN for this single-operation batch, as `hire.postgres.test.ts` records.
  const [agent] = await scope.netBatch(
    (db) => [
      db.agent.findFirst({
        where: {
          id,
          ...buildAvailableAgentWhereClause(creditCosts, cardanoV2ReadySources),
        },
        include: {
          ...agentPricingInclude,
          ...agentMetadataOverrideScalarsInclude,
          paymentSources: {
            where: cardanoV2PaymentSourcesOnRail(),
            include: {
              amounts: true,
            },
            orderBy: { sourceIndex: "asc" },
          },
        },
      }),
    ],
    AGENT_PRICING_READ_TRANSACTION_OPTIONS.isolationLevel,
  );

  if (!agent) {
    throw notFound("Agent not found");
  }

  const cost = getAgentCost(agent, creditCosts);
  if (!isV2HireAgent(agent) && maxCents !== null && cost.cents > maxCents) {
    throw badRequest("Credit cost exceeds maximum accepted credits");
  }
  let preparedV2Sources = new Map<number, PreparedV2Source>();
  if (isV2HireAgent(agent) && agent.pricing.pricingType === PricingType.FIXED) {
    preparedV2Sources = prepareEligibleV2Sources(
      agent.blockchainIdentifier,
      agent.paymentSources,
      creditCosts,
      cardanoV2ReadySources,
      maxCents ?? cost.cents,
      maxCents !== null,
    );
    // No billable ready source can satisfy this hire — fail before start_job
    // so the seller never accepts work we will refuse to track.
    if (preparedV2Sources.size === 0) {
      throw unprocessableEntity(
        "No purchase-ready payment sources available for this agent",
        { reportToSentry: true },
      );
    }
  }

  return {
    agent,
    cost,
    creditCosts,
    cardanoV2ReadySources,
    preparedV2Sources,
  };
}

/**
 * A V2 Agent by declared payment type or by its registry identifier: free and
 * EVM-only V2 Agents report "None" yet settle through a V2 contract.
 */
export function isV2HireAgent(agent: {
  paymentType: PaymentType;
  blockchainIdentifier: string;
}): boolean {
  return (
    agent.paymentType === PaymentType.WEB3_CARDANO_V2 ||
    isV2RegistryIdentifier(agent.blockchainIdentifier)
  );
}

export interface PreparedV2Source {
  amounts: { unit: string; amount: string }[];
  cents: bigint;
}

function prepareEligibleV2Sources(
  agentIdentifier: string,
  sources: readonly {
    sourceIndex: number;
    pricingType: PricingType;
    address: string;
    amounts: { unit: string; amount: bigint }[];
  }[],
  creditCosts: CreditCost[],
  readySources: readonly CardanoV2ReadySource[],
  acceptedCeilingCents: bigint,
  hasExplicitCeiling: boolean,
): Map<number, PreparedV2Source> {
  const prepared = new Map<number, PreparedV2Source>();
  for (const source of sources) {
    if (
      !isCardanoV2SourceReady(agentIdentifier, source.address, readySources)
    ) {
      continue;
    }
    if (
      source.pricingType !== PricingType.FIXED ||
      source.amounts.length === 0
    ) {
      throw unprocessableEntity(
        "Paid V2 agent has a purchase-ready source without fixed pricing",
        { reportToSentry: true },
      );
    }
    const amounts = aggregateAmountsByUnit(source.amounts);
    if (amounts.length > MAX_PAYMENT_NODE_PURCHASE_AMOUNTS) {
      throw unprocessableEntity(
        "Paid V2 agent has a purchase-ready source with too many assets",
        { reportToSentry: true },
      );
    }
    let cents: bigint;
    try {
      cents = calculateCentsFromMasumiAmountStrings(amounts, creditCosts);
    } catch {
      throw unprocessableEntity(
        "Paid V2 agent has a purchase-ready source with unbillable units",
        { reportToSentry: true },
      );
    }
    if (cents > acceptedCeilingCents) {
      if (hasExplicitCeiling) {
        throw badRequest("Credit cost exceeds maximum accepted credits");
      }
      throw unprocessableEntity(
        "The agent's purchase-ready payment sources exceed its listed price",
        { reportToSentry: true },
      );
    }
    prepared.set(source.sourceIndex, { amounts, cents });
  }
  return prepared;
}

/**
 * Sums pricing rows per unit. The payment node compares Amounts as per-unit
 * sums and caps the array at 7 entries, so duplicate-unit registrations must
 * be aggregated before sending.
 */
export function aggregateAmountsByUnit(
  rows: readonly { unit: string; amount: bigint }[],
): { unit: string; amount: string }[] {
  const sums = new Map<string, bigint>();
  for (const row of rows) {
    const unit = normalizeMasumiPaymentUnit(row.unit);
    sums.set(unit, (sums.get(unit) ?? 0n) + row.amount);
  }
  return Array.from(sums, ([unit, amount]) => ({
    unit,
    amount: amount.toString(),
  }));
}
