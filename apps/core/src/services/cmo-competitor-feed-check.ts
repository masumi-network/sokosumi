import type { SaveCompetitorFeedInput } from "@sokosumi/soko-bot";
import { CMO_CHANNELS } from "@sokosumi/utils";

const SOCIAL_NETWORKS = Object.entries(CMO_CHANNELS)
  .filter(([, channel]) => channel.group === "social")
  .map(([key, { name }]) => ({
    key,
    name,
    // "X" is a letter in any other case; every other name is a word.
    pattern:
      key === "x" ? /\bX\b|\bTwitter\b/ : new RegExp(`\\b${name}\\b`, "i"),
  }));

/** Meanings that share this much of their words say the same thing. */
const SAME_MEANING = 0.8;

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function overlap(a: Set<string>, b: Set<string>): number {
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.max(1, a.size + b.size - shared);
}

/** Cuso naming himself: "Cuso's X account", "the Cuso homepage". */
const NAMES_CUSO = /\bCuso\b/i;

/** The competitor's name, or a word of it long enough to be its own. */
function namesCompetitor(text: string, competitor: string): boolean {
  const said = words(text);
  return [...words(competitor)].some(
    (word) =>
      (word.length >= 4 || word === competitor.toLowerCase()) && said.has(word),
  );
}

/**
 * What CMO asks of Cuso's feed beyond the facts: each item's meaning is about
 * that competitor's move, no two say the same, meaning and move speak to the
 * owner ("your homepage", never "Cuso's"), and a suggested move uses a
 * network the business has connected or says to connect it first.
 */
export function cusoFeedProblems(
  feed: SaveCompetitorFeedInput,
  competitorNames: ReadonlyMap<string, string>,
  connectedNetworks: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  const connected = SOCIAL_NETWORKS.filter(({ key }) =>
    connectedNetworks.has(key),
  ).map(({ name }) => name);
  feed.items.forEach((item, index) => {
    const competitor = competitorNames.get(item.competitorId);
    if (!competitor) return;
    if (!namesCompetitor(item.meaning, competitor))
      problems.push(
        `The meaning for ${competitor}'s move would fit any move: "${item.meaning}". Name ${competitor} and what it did, then say what that changes for this business.`,
      );
    const twin = feed.items
      .slice(0, index)
      .find(
        (earlier) =>
          overlap(words(earlier.meaning), words(item.meaning)) >= SAME_MEANING,
      );
    if (twin)
      problems.push(
        `Two items have almost the same meaning: "${item.meaning}". Say for each move what that move changes for this business.`,
      );
    for (const [field, text] of [
      ["meaning", item.meaning],
      ["move", item.move],
    ] as const) {
      if (NAMES_CUSO.test(text))
        problems.push(
          `The ${field} for ${competitor}'s move says "Cuso": "${text}". Cuso is you. Write to the owner about their business: "your homepage", "your X account", "your pricing page".`,
        );
    }
    if (/\bconnect\b/i.test(item.move)) return;
    for (const { key, name, pattern } of SOCIAL_NETWORKS) {
      if (connectedNetworks.has(key) || !pattern.test(item.move)) continue;
      problems.push(
        `The move for ${competitor} uses ${name}, which is not connected. ${
          connected.length > 0
            ? `Use ${connected.join(" or ")}, or`
            : "No network is connected yet, so"
        } write it as "Connect ${name}, then …".`,
      );
    }
  });
  return problems;
}
