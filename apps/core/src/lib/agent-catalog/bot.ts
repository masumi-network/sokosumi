import type { CreditCost, Prisma } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/utils";
import { calculateCentsFromMasumiAmountStrings } from "@/helpers/agent-cost";
import type { NetworkScope } from "@/lib/db/network-scope";
import {
  AGENT_PRICING_READ_TRANSACTION_OPTIONS,
  readRates,
} from "./availability";

interface AgentPricingRow {
  pricingType: string;
  fixedPricing: {
    amounts: readonly { amount: bigint; unit: string }[];
  } | null;
}

/** What hiring an Agent costs, as the bot reads it before `hire_agent`. */
function agentPriceHint(
  pricing: AgentPricingRow,
  creditCosts: readonly CreditCost[],
) {
  if (pricing.pricingType === "FREE") {
    return {
      pricingType: pricing.pricingType,
      credits: 0,
      maxCreditsRequired: false,
      minimumMaxCredits: null,
    };
  }

  if (
    pricing.pricingType !== "FIXED" ||
    !pricing.fixedPricing ||
    pricing.fixedPricing.amounts.length === 0
  ) {
    return {
      pricingType: pricing.pricingType,
      credits: null,
      maxCreditsRequired: pricing.pricingType === "FIXED",
      minimumMaxCredits: null,
    };
  }

  try {
    const price = calculateCentsFromMasumiAmountStrings(
      pricing.fixedPricing.amounts.map((amount) => ({
        amount: amount.amount.toString(),
        unit: amount.unit,
      })),
      [...creditCosts],
    );
    return {
      pricingType: pricing.pricingType,
      credits: convertCentsToCredits(price),
      maxCreditsRequired: true,
      minimumMaxCredits: convertCentsToCredits(price),
    };
  } catch {
    return {
      pricingType: pricing.pricingType,
      credits: null,
      maxCreditsRequired: true,
      minimumMaxCredits: null,
    };
  }
}

/**
 * Agents the bot can hire: listed, online, and reachable at their own or an
 * overridden endpoint — the one `toMasumiAgent` resolves, so an Agent
 * reachable only through its override is findable as well as hireable.
 */
const SOKO_BOT_HIREABLE_AGENT_WHERE: Prisma.AgentWhereInput = {
  isShown: true,
  status: "ONLINE",
  OR: [
    { apiBaseUrl: { not: null } },
    { metadataOverride: { apiBaseUrl: { not: null } } },
  ],
};

/** Hireable Agents, most used first, with what each costs and their count. */
export async function searchForBot(scope: NetworkScope, take: number) {
  const [agents, count, creditCosts] = await scope.netBatch(
    (db) => [
      db.agent.findMany({
        where: SOKO_BOT_HIREABLE_AGENT_WHERE,
        orderBy: [{ jobCount: "desc" }, { id: "desc" }],
        take,
        select: {
          id: true,
          name: true,
          summary: true,
          description: true,
          capabilityName: true,
          paymentType: true,
          riskClassification: true,
          pricing: {
            select: {
              pricingType: true,
              fixedPricing: {
                select: { amounts: { select: { amount: true, unit: true } } },
              },
            },
          },
        },
      }),
      db.agent.count({ where: SOKO_BOT_HIREABLE_AGENT_WHERE }),
      readRates(db.creditCost),
    ],
    AGENT_PRICING_READ_TRANSACTION_OPTIONS.isolationLevel,
  );
  return {
    count,
    agents: agents.map((agent) => ({
      ...agent,
      price: agentPriceHint(agent.pricing, creditCosts),
    })),
  };
}

export function namesForClassifier(scope: NetworkScope) {
  return scope.networkDb.agent.findMany({
    where: { isShown: true, status: "ONLINE", apiBaseUrl: { not: null } },
    select: { id: true, name: true },
    take: 50,
  });
}

export async function nameOf(scope: NetworkScope, id: string) {
  const agent = await scope.networkDb.agent.findUnique({
    where: { id },
    select: { name: true },
  });
  return agent?.name ?? null;
}

export function forBotTool(scope: NetworkScope, id: string) {
  return scope.networkDb.agent.findFirst({
    where: { id, isShown: true },
    select: {
      id: true,
      name: true,
      status: true,
      blockchainIdentifier: true,
      apiBaseUrl: true,
      metadataOverride: { select: { apiBaseUrl: true } },
    },
  });
}
