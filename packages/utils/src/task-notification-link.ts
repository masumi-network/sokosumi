/** A Task reference stays the only identifier in a notification. Authorization
 * for the linked analysis is checked when the recipient opens the result. */
export function taskNotificationHref(input: {
  referenceId: string;
  messageKey?: string;
  metadata?: Record<string, unknown> | null;
}): string {
  const task = `/tasks/${encodeURIComponent(input.referenceId)}`;
  // Rows created before result hints existed resolve against the current Task.
  const opensResult =
    (input.messageKey === "Notifications.Task.completed" &&
      input.metadata?.seoResult !== false) ||
    input.messageKey === SEO_MONITOR_WORSE_KEY;
  return opensResult ? `${task}/result` : task;
}

/** A scheduled SEO check got worse: the change is shown on the result page. */
const SEO_MONITOR_WORSE_KEY = "Notifications.Task.seoMonitorWorse";

export function isSeoTaskCompletion(
  key: string | undefined,
  data: Record<string, unknown> | null | undefined,
): boolean {
  return key === "Notifications.Task.completed" && data?.seoResult === true;
}
