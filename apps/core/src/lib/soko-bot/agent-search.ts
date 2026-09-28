import type { CreditCost, Prisma } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/utils";
import { AGENT_PRICING_READ_TRANSACTION_OPTIONS } from "@/helpers/agent";
import { calculateCentsFromMasumiAmountStrings } from "@/helpers/agent-cost";
import prisma from "@/lib/db/prisma";
import { askJev } from "./jev";

export interface AgentSearchCandidate {
  id: string;
  name: string;
  summary: string | null;
  description: string | null;
  capabilityName: string | null;
}

/** How many candidates Jev rates; one call answers them all. */
export const MAX_RATED_AGENTS = 12;
const TIMEOUT_MS = 3_000;
const FIELD_LENGTH = 400;
/** A rating below this is not offered as a fit. */
export const MIN_AGENT_FIT = 0.4;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "can",
  "who",
  "our",
  "your",
  "into",
  "from",
  "about",
  "write",
  "make",
  "create",
  "find",
  "agent",
  "agents",
  "marketplace",
]);

/** The words of a request worth matching; "SEO blog posts" → seo, blog, post. */
export function queryWords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    .map((word) => (word.length > 4 ? word.replace(/s$/, "") : word));
  return [...new Set(words)];
}

/**
 * Distinct request words an Agent mentions; a hit in its name or capability
 * counts double. The whole query as one substring matched no listing for a
 * request worded differently, such as "SEO blog posts".
 */
export function agentWordScore(
  words: readonly string[],
  agent: AgentSearchCandidate,
): number {
  const title = `${agent.name} ${agent.capabilityName ?? ""}`.toLowerCase();
  const body =
    `${agent.summary ?? ""} ${agent.description ?? ""}`.toLowerCase();
  return words.reduce(
    (score, word) =>
      score + (title.includes(word) ? 2 : body.includes(word) ? 1 : 0),
    0,
  );
}

/**
 * Jev's probability that each candidate can do the request, by Agent id.
 * `null` when Jev is unavailable; the word ranking then stands on its own.
 */
export async function rateAgentFit(
  request: string,
  candidates: readonly AgentSearchCandidate[],
): Promise<Map<string, number> | null> {
  if (candidates.length === 0) return new Map();
  const rated = candidates.slice(0, MAX_RATED_AGENTS);
  try {
    const answers = await askJev({
      state: {
        request: request.slice(0, FIELD_LENGTH),
        agents: rated.map((agent, index) => ({
          key: `agent${index}`,
          name: agent.name.slice(0, FIELD_LENGTH),
          capability: agent.capabilityName?.slice(0, FIELD_LENGTH) ?? null,
          summary: (agent.summary ?? agent.description)?.slice(0, FIELD_LENGTH),
        })),
      },
      questions: Object.fromEntries(
        rated.map((_, index) => [
          `agent${index}`,
          `Can the marketplace Agent listed under key "agent${index}" do what the request asks, judged by its name, capability and summary? A related topic is not enough: it must produce the requested kind of work.`,
        ]),
      ),
      timeoutMs: TIMEOUT_MS,
    });
    const ratings = new Map<string, number>();
    rated.forEach((agent, index) => {
      const probability = answers.get(`agent${index}`);
      if (probability !== undefined) ratings.set(agent.id, probability);
    });
    return ratings;
  } catch (error) {
    console.warn("Soko Bot agent fit rating failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

export interface AgentPricingRow {
  pricingType: string;
  fixedPricing: {
    amounts: readonly { amount: bigint; unit: string }[];
  } | null;
}

/** What hiring an Agent costs, as the bot reads it before `hire_agent`. */
export function agentPriceHint(
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
export const SOKO_BOT_HIREABLE_AGENT_WHERE: Prisma.AgentWhereInput = {
  isShown: true,
  status: "ONLINE",
  OR: [
    { apiBaseUrl: { not: null } },
    { metadataOverride: { apiBaseUrl: { not: null } } },
  ],
};

/** Hireable Agents, most used first, with what each costs and their count. */
export async function listHireableAgents(take: number) {
  const [agents, count, creditCosts] = await prisma.$transaction(
    [
      prisma.agent.findMany({
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
      prisma.agent.count({ where: SOKO_BOT_HIREABLE_AGENT_WHERE }),
      prisma.creditCost.findMany(),
    ],
    AGENT_PRICING_READ_TRANSACTION_OPTIONS,
  );
  return {
    count,
    agents: agents.map((agent) => ({
      ...agent,
      price: agentPriceHint(agent.pricing, creditCosts),
    })),
  };
}
