import { experimental_evaluate, gateway } from "ai";
import { SOKO_BOT_ROUTE_MODEL } from "./classifier";

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
    const result = await experimental_evaluate({
      model: gateway.evaluationModel(SOKO_BOT_ROUTE_MODEL),
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
          {
            type: "boolean" as const,
            instructions: `Can the marketplace Agent listed under key "agent${index}" do what the request asks, judged by its name, capability and summary? A related topic is not enough: it must produce the requested kind of work.`,
          },
        ]),
      ),
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      maxRetries: 1,
      providerOptions: {
        gateway: { zeroDataRetention: true, disallowPromptTraining: true },
      },
    });
    const answers = result.answers as Record<
      string,
      { probability?: number } | undefined
    >;
    const ratings = new Map<string, number>();
    rated.forEach((agent, index) => {
      const probability = answers[`agent${index}`]?.probability;
      if (typeof probability === "number") ratings.set(agent.id, probability);
    });
    return ratings;
  } catch (error) {
    console.warn("Soko Bot agent fit rating failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}
