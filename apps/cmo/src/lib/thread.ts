import type { CmoOverview } from "@sokosumi/core-client";

import type { CusoMessage } from "./chat-messages";

type Update = CmoOverview["updates"][number];

/**
 * One item in the chat thread. Messages come from the chat with Cuso; cards
 * come from what Cuso saved (Brand Brain, strategy, reports) and from the
 * owner's own steps (approval). Nothing here is invented: every card is a
 * record in Core.
 */
export type ThreadItem =
  | { kind: "message"; at: string; message: CusoMessage }
  | { kind: "learning"; at: string; done: boolean }
  | { kind: "brandBrain"; at: string }
  | { kind: "strategy"; at: string }
  | { kind: "subscribe"; at: string }
  | { kind: "connect"; at: string }
  | { kind: "update"; at: string; update: Update };

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

/**
 * The thread in time order. Cards that wait for the owner (subscribe,
 * connect) sit right after the step that made them relevant.
 */
export function buildThread(
  overview: CmoOverview,
  messages: CusoMessage[],
): ThreadItem[] {
  const items: ThreadItem[] = messages.map((message) => ({
    kind: "message",
    at: message.createdAt,
    message,
  }));
  const created = iso(overview.createdAt) ?? new Date(0).toISOString();
  items.push({
    kind: "learning",
    at: created,
    done: overview.brandBrain !== null,
  });
  const brainAt = iso(overview.brandBrainUpdatedAt);
  if (overview.brandBrain && brainAt) {
    items.push({ kind: "brandBrain", at: brainAt });
  }
  const strategyAt = iso(overview.strategyUpdatedAt);
  if (overview.strategy && strategyAt) {
    items.push({ kind: "strategy", at: strategyAt });
  }
  const approvedAt = iso(overview.strategyApprovedAt);
  if (approvedAt) {
    items.push({ kind: "subscribe", at: approvedAt });
    if (overview.channels.length === 0) {
      items.push({ kind: "connect", at: approvedAt });
    }
  }
  for (const update of overview.updates) {
    items.push({ kind: "update", at: iso(update.at) ?? created, update });
  }
  // Stable: cards built at the same moment keep the order pushed above.
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.at.localeCompare(b.item.at) || a.index - b.index)
    .map(({ item }) => item);
}

/** Cuso's state in a word, for the chat header. */
export function cusoStatus(overview: CmoOverview): string {
  if (!overview.brandBrain) return "Learning";
  if (overview.billing.availableCredits <= 0 && overview.strategyApprovedAt) {
    return "Paused";
  }
  if (overview.botStatus === "RUNNING") return "Working";
  if (!overview.strategy) return "Planning";
  if (!overview.strategyApprovedAt) return "Waiting for approval";
  if (!overview.subscriptionActive) return "Strategy approved";
  if (overview.channels.length === 0) return "Waiting for a channel";
  return "Running";
}
