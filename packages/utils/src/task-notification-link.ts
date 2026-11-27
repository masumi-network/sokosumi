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
    SEO_MONITOR_ALERT_KEYS.includes(input.messageKey);
  return opensResult ? `${task}/result` : task;
}

/** Alerts of a scheduled SEO check: what changed is shown on the result page. */
const SEO_MONITOR_ALERT_KEYS: readonly (string | undefined)[] = [
  "Notifications.Task.seoMonitorWorse",
  "Notifications.Task.seoMonitorClicksDrop",
];

export function isSeoTaskCompletion(
  key: string | undefined,
  data: Record<string, unknown> | null | undefined,
): boolean {
  return key === "Notifications.Task.completed" && data?.seoResult === true;
}
