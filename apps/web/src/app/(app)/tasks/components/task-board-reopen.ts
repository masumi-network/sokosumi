/**
 * Board reopen uses optimistic column moves. Dismissing the comment dialog
 * must not roll back while the status event request is still in flight —
 * Core may still accept the reopen after Escape / outside-click.
 */
export function shouldRollbackBoardReopenOnDismiss(
  isPending: boolean,
): boolean {
  return !isPending;
}
