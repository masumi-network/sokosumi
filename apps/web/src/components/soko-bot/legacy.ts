import type { SokoBotLegacyMessage } from "@/lib/clients/generated/core";

export type LegacyRole = "user" | "assistant" | "system";

/** Normalise free-form legacy `role` strings to the three roles the UI renders. */
export function normalizeLegacyRole(role: string): LegacyRole {
  const value = role.trim().toLowerCase();
  if (value === "user" || value === "human") return "user";
  if (value === "system" || value === "tool") return "system";
  return "assistant";
}

/** API returns newest-first; conversation reads oldest-first. */
export function orderLegacyMessagesForDisplay(
  messages: readonly SokoBotLegacyMessage[],
): SokoBotLegacyMessage[] {
  return [...messages].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

export interface LegacyHistoryRange {
  from: Date;
  to: Date;
}

export function legacyHistoryRange(
  messages: readonly SokoBotLegacyMessage[],
): LegacyHistoryRange | null {
  if (messages.length === 0) return null;
  const times = messages.map((message) => message.createdAt.getTime());
  return {
    from: new Date(Math.min(...times)),
    to: new Date(Math.max(...times)),
  };
}
