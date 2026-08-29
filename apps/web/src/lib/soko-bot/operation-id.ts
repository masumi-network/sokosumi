/**
 * Browser-side idempotency handle for operator actions. Generated when an
 * action is selected, kept across failed submits so a retry re-sends the same
 * operation, and regenerated after success or when the operator abandons the
 * dialog / picks a different action.
 */
export function newOperationId(): string {
  return crypto.randomUUID();
}
