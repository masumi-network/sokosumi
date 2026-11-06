import type { CmoOverview } from "@sokosumi/core-client";

import type { CusoMessage } from "./chat-messages";
import { strategyApproved } from "./strategy";

type Update = CmoOverview["updates"][number];

/**
 * One item in the chat thread. Messages come from the chat with Cuso; cards
 * come from what Cuso saved (Brand Brain, strategy, reports) and from the
 * owner's own steps (approval). Nothing here is invented: every card is a
 * record in Core.
 */
export type ThreadItem =
  | { kind: "message"; at: string; message: CusoMessage }
  | { kind: "welcome"; at: string }
  | { kind: "learning"; at: string; done: boolean }
  | { kind: "brandBrain"; at: string }
  | { kind: "strategy"; at: string }
  | { kind: "connect"; at: string }
  | { kind: "production"; at: string }
  | { kind: "update"; at: string; update: Update };

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

/**
 * The thread in time order. A card that waits for the owner (connect) sits
 * right after the step that made it relevant. Hiring already showed the
 * research, Brand Brain and plan, so once a plan is approved the thread
 * starts with one welcome instead of replaying them.
 */
export function buildThread(
  overview: CmoOverview,
  messages: CusoMessage[],
): ThreadItem[] {
  // A report is a message in the room; it shows as its card below.
  const reports = new Set(overview.updates.map((update) => update.id));
  const hired = iso(overview.hiredAt);
  const items: ThreadItem[] = messages
    .filter(
      (message) =>
        !reports.has(message.id) && (!hired || message.createdAt > hired),
    )
    .map((message) => ({
      kind: "message",
      at: message.createdAt,
      message,
    }));
  const created = iso(overview.createdAt) ?? new Date(0).toISOString();
  if (hired) {
    items.push({ kind: "welcome", at: hired });
  } else {
    items.push({
      kind: "learning",
      at: created,
      done: overview.brandBrain !== null,
    });
    const brainAt = iso(overview.brandBrainUpdatedAt);
    if (overview.brandBrain && brainAt) {
      items.push({ kind: "brandBrain", at: brainAt });
    }
  }
  // After hiring, the plan shows here only while a change waits for approval.
  const strategyAt = iso(overview.strategyVersion?.updatedAt);
  if (
    overview.strategy &&
    strategyAt &&
    (!hired || !strategyApproved(overview))
  ) {
    items.push({ kind: "strategy", at: strategyAt });
  }
  // Hired, the month runs on the approved plan even while a newer version
  // waits for approval: the connect and production cards stay.
  const approvedAt = hired ?? iso(overview.strategyVersion?.approvedAt);
  if (approvedAt && overview.channels.length === 0) {
    items.push({ kind: "connect", at: approvedAt });
  }
  // Making the month shows as one progress card, not Cuso's own reports on
  // each round: it sits where the newest of them would.
  const production = overview.updates.filter(
    (update) => update.kind === "production",
  );
  if (approvedAt && overview.production.total > 0) {
    const latest = production.map((update) => iso(update.at) ?? created).sort();
    items.push({ kind: "production", at: latest.at(-1) ?? approvedAt });
  }
  for (const update of overview.updates) {
    if (update.kind === "production") continue;
    items.push({ kind: "update", at: iso(update.at) ?? created, update });
  }
  // Stable: cards built at the same moment keep the order pushed above.
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.at.localeCompare(b.item.at) || a.index - b.index)
    .map(({ item }) => item);
}

/** What Cuso is doing, in the order that decides it. */
export type CusoState =
  | "stopped"
  | "learning"
  | "needs-answers"
  | "paused"
  | "working"
  | "planning"
  | "waiting-approval"
  | "waiting-channel"
  | "running";

/** Each state in a word, for the chat header and Cuso's status card. */
const CUSO_STATE_LABEL: Record<CusoState, string> = {
  stopped: "Stopped",
  learning: "Learning",
  "needs-answers": "Needs your answers",
  paused: "Paused",
  working: "Working",
  planning: "Planning",
  "waiting-approval": "Waiting for approval",
  "waiting-channel": "Waiting for a channel",
  running: "Running",
};

export function cusoState(overview: CmoOverview): CusoState {
  if (overview.learning === "failed") return "stopped";
  if (overview.learning === "running") return "learning";
  if (!overview.brandBrain) return "needs-answers";
  if (overview.billing.availableCredits <= 0 && strategyApproved(overview)) {
    return "paused";
  }
  if (overview.botStatus === "RUNNING") return "working";
  if (!overview.strategy) return "planning";
  if (!strategyApproved(overview)) return "waiting-approval";
  if (overview.channels.length === 0) return "waiting-channel";
  return "running";
}

/** Cuso's state in a word, for the chat header. */
export function cusoStatus(overview: CmoOverview): string {
  return CUSO_STATE_LABEL[cusoState(overview)];
}
