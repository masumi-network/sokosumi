import {
  agentWordScore,
  listHireableAgents,
  MAX_RATED_AGENTS,
  MIN_AGENT_FIT,
  queryWords,
  rateAgentFit,
} from "@/lib/soko-bot/agent-search";

/** Near misses shown when no Agent fits, so "none fits" still informs. */
export const CLOSEST_AGENTS = 3;

/** Hireable Agents best suited to `query`, with prices and a fit rating. */
export async function findHireableAgents(query: string | undefined) {
  const { agents: rows } = await listHireableAgents(500);
  const words = query ? queryWords(query) : [];
  const matched = rows
    .map((row) => ({ row, score: agentWordScore(words, row) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.row);
  // Word hits first, then the most used Agents, so a request phrased in
  // other words than a listing still gets rated.
  const candidates = query
    ? [...new Set([...matched, ...rows])].slice(0, MAX_RATED_AGENTS)
    : rows.slice(0, 20);
  const ratings = query ? await rateAgentFit(query, candidates) : null;
  // Without Jev nothing was judged, so nothing may be called a non-fit: the
  // word matches, or else the most used Agents, go back unrated.
  const results = ratings
    ? candidates
        .filter((row) => (ratings.get(row.id) ?? 0) >= MIN_AGENT_FIT)
        .sort((a, b) => (ratings.get(b.id) ?? 0) - (ratings.get(a.id) ?? 0))
    : (matched.length ? matched : candidates).slice(0, 10);
  const describe = (row: (typeof rows)[number]) => ({
    id: row.id,
    name: row.name,
    summary: (row.summary ?? row.description)?.slice(0, 300) ?? null,
    capability: row.capabilityName,
    paymentType: row.paymentType,
    riskClassification: row.riskClassification,
    price: row.price,
    fit: ratings?.has(row.id)
      ? Math.round((ratings.get(row.id) ?? 0) * 100) / 100
      : null,
  });
  if (!ratings || !query || results.length > 0)
    return { agents: results.map(describe), availableAgents: rows.length };
  // Nothing fits: the nearest listings let the bot say what the marketplace
  // does offer, and what it would cost, without passing them off as a fit.
  const closest = [...candidates]
    .sort((a, b) => (ratings.get(b.id) ?? 0) - (ratings.get(a.id) ?? 0))
    .slice(0, CLOSEST_AGENTS);
  return {
    agents: [],
    closest: closest.map(describe),
    availableAgents: rows.length,
    note: `No available Agent fits "${query}" among the ${rows.length} listed. Tell the owner that none fits rather than hiring one that does something else. \`closest\` are the nearest listings: they do related work, not this; name them only as that, and offer another way to get it done, such as doing it yourself or a Task for a Coworker.`,
  };
}
