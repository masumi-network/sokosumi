/**
 * The Cmd+K corpus axes. These are the `history` feed's kinds, not the credit
 * ledger's: the palette must still find a task or a job that never charged.
 */
export const HISTORY_SEARCH_KINDS = ["task", "job", "image"] as const;

export type HistorySearchKind = (typeof HISTORY_SEARCH_KINDS)[number];

export type HistorySearchScope = "owned" | "workspace";

/**
 * Personal scope, in an organization too: the palette is "things I did", and
 * the feed endpoint widens to the workspace only when asked.
 */
export function getHistorySearchScope(
  _activeOrganizationId: string | null,
): HistorySearchScope {
  return "owned";
}
