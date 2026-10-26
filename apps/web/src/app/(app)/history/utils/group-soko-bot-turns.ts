import type { TransactionHistoryItem } from "@/lib/services/history.service";

type SokoBotItem = Extract<TransactionHistoryItem, { kind: "sokoBot" }>;

export type HistoryEntry =
  | { type: "item"; item: TransactionHistoryItem }
  | {
      type: "sokoBotDay";
      /** Stable across "load more": the bot and the day it worked. */
      key: string;
      items: SokoBotItem[];
      credits: number;
    };

/**
 * One row per assistant per day instead of one per turn.
 *
 * A Soko Bot charges for every turn, and a busy day is dozens of them: listed
 * one by one they bury the Tasks and Jobs around them. The group sits where
 * the day's newest turn was, so the list stays newest first; a single turn
 * stays a plain row. `dayOf` is the viewer's local day.
 */
export function groupSokoBotTurns(
  items: readonly TransactionHistoryItem[],
  dayOf: (date: Date) => string,
): HistoryEntry[] {
  const groups = new Map<string, SokoBotItem[]>();
  for (const item of items) {
    if (item.kind !== "sokoBot") continue;
    const key = `${item.sokoBotId}:${dayOf(item.consumedAt)}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const placed = new Set<string>();
  const entries: HistoryEntry[] = [];
  for (const item of items) {
    if (item.kind !== "sokoBot") {
      entries.push({ type: "item", item });
      continue;
    }
    const key = `${item.sokoBotId}:${dayOf(item.consumedAt)}`;
    const group = groups.get(key) ?? [item];
    if (group.length === 1) {
      entries.push({ type: "item", item });
      continue;
    }
    if (placed.has(key)) continue;
    placed.add(key);
    entries.push({
      type: "sokoBotDay",
      key,
      items: group,
      credits: group.reduce((sum, turn) => sum + turn.credits, 0),
    });
  }
  return entries;
}
