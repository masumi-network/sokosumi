import type { CmoOverview } from "@sokosumi/core-client";

import { channelLabel, SOCIAL_PROVIDERS } from "./calendar";

/**
 * "Plausible Analytics: privacy-friendly stats" → "Plausible Analytics".
 * Null when the line describes a range ("Naturally leavened breads, …")
 * rather than naming one product.
 */
function productName(product: string): string | null {
  const name = product.split(/[:(.;]|\s[-|·]\s/)[0]?.trim() ?? product;
  return name.split(/\s+/).length <= 4 ? name : null;
}

/**
 * Changes a founder might ask for, built from their own plan: real channel
 * names, their first product, their goal. Never a channel the plan lacks.
 */
export function changeIdeas(overview: CmoOverview): string[] {
  const strategy = overview.strategy;
  if (!strategy) return [];
  const social = strategy.channels
    .map((channel) => channel.channel)
    .filter((channel) =>
      (SOCIAL_PROVIDERS as readonly string[]).includes(channel),
    );
  const ideas: string[] = [];
  const [more, less] = [social[0], social.at(-1)];
  if (more && less && more !== less) {
    ideas.push(`More ${channelLabel(more)}, less ${channelLabel(less)}`);
  }
  ideas.push("Fewer posts, more depth");
  const product = overview.brandBrain?.products
    .map(productName)
    .find((name) => name !== null);
  if (product) ideas.push(`Lead with ${product}`);
  ideas.push(
    /playful/i.test(overview.brandBrain?.voice.tone ?? "")
      ? "A calmer, more direct voice"
      : "A more playful voice",
  );
  return ideas.slice(0, 4);
}
