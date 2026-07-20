import {
  HERMES_CONFIRMATION_CARD_KIND,
  parseConfirmationCardMessage,
} from "@/lib/hermes/confirmation-card-message";
import type { HermesPendingConfirmation } from "@/lib/hermes/types";

import type {
  Message,
  ResolvedConfirmationEntry,
  TimelineEntry,
} from "./types";

export function getPersistedResolvedIds(messages: Message[]): Set<string> {
  return new Set(
    messages
      .filter((m) => m.kind === HERMES_CONFIRMATION_CARD_KIND)
      .map((m) => parseConfirmationCardMessage(m.content)?.confirmation.id)
      .filter((id): id is string => Boolean(id)),
  );
}

export function getPendingCards(
  instancePending: HermesPendingConfirmation[] | undefined,
  mockConfirmations: HermesPendingConfirmation[],
  resolvedConfirmations: Map<string, ResolvedConfirmationEntry>,
  persistedResolvedIds: Set<string>,
): HermesPendingConfirmation[] {
  return [...(instancePending ?? []), ...mockConfirmations].filter(
    (c) => !resolvedConfirmations.has(c.id) && !persistedResolvedIds.has(c.id),
  );
}

export function buildTimeline(
  messages: Message[],
  resolvedConfirmations: Map<string, ResolvedConfirmationEntry>,
): TimelineEntry[] {
  const resolvedCards = Array.from(resolvedConfirmations.values());

  return [
    ...messages.flatMap((message): TimelineEntry[] => {
      const ts = new Date(message.createdAt).getTime() || 0;
      // Persisted resolved-confirmation cards (written by Core at
      // approve/reject time) render as read-only ConfirmationCards, not
      // prose. While this tab's own resolved card is still in memory it
      // owns the slot — skip the persisted copy to avoid a duplicate;
      // after a reload only the persisted card exists. Unparseable rows
      // are dropped rather than surfacing raw JSON in the chat.
      if (message.kind === HERMES_CONFIRMATION_CARD_KIND) {
        const parsed = parseConfirmationCardMessage(message.content);
        if (!parsed || resolvedConfirmations.has(parsed.confirmation.id)) {
          return [];
        }
        return [
          {
            kind: "resolved" as const,
            ts,
            key: message.id,
            entry: {
              confirmation: parsed.confirmation,
              resolution: parsed.resolution,
              timelineTs: ts,
            },
          },
        ];
      }
      return [{ kind: "message" as const, ts, key: message.id, message }];
    }),
    ...resolvedCards.map((entry) => ({
      kind: "resolved" as const,
      // `timelineTs` was snapshotted at approval as "just past everything
      // visible right now", so the card sits after the message that raised
      // it and before the orchestrator's `confirmation_resolved` reply —
      // regardless of client/server clock skew or the optimistic→persisted
      // timestamp rewrite of surrounding messages.
      ts: entry.timelineTs,
      key: `resolved-${entry.confirmation.id}`,
      entry,
    })),
  ].sort((a, b) => a.ts - b.ts);
}

export function isChatEmpty(
  messages: Message[],
  pendingCards: HermesPendingConfirmation[],
  resolvedCards: ResolvedConfirmationEntry[],
): boolean {
  return (
    messages.length === 0 &&
    pendingCards.length === 0 &&
    resolvedCards.length === 0
  );
}
