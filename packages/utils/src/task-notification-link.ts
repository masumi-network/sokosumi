/** A Task reference stays the only identifier in a notification. Authorization
 * for the linked analysis is checked when the recipient opens the result. */
export function taskNotificationHref(input: {
  referenceId: string;
  messageKey?: string;
  metadata?: Record<string, unknown> | null;
}): string {
  const task = `/tasks/${encodeURIComponent(input.referenceId)}`;
  // Rows created before result hints existed resolve against the current Task.
  return input.messageKey === "Notifications.Task.completed" &&
    input.metadata?.seoResult !== false
    ? `${task}/result`
    : task;
}

export function isSeoTaskCompletion(
  key: string | undefined,
  data: Record<string, unknown> | null | undefined,
): boolean {
  return key === "Notifications.Task.completed" && data?.seoResult === true;
}
