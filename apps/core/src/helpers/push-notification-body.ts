const PUSH_NOTIFICATION_BODY_TEMPLATES: Record<string, string> = {
  "Notifications.Job.completed": "{agentName} completed {jobName}",
  "Notifications.Job.failed": "{agentName} failed to complete {jobName}",
  "Notifications.Job.paymentFailed": "Payment failed for {jobName}",
  "Notifications.Job.inputRequired":
    "{agentName} needs your input for {jobName}",
  "Notifications.Job.refundResolved": "{jobName} was refunded",
  "Notifications.Job.disputeResolved": "Dispute resolved for {jobName}",
  "Notifications.Task.inputRequired":
    "{coworkerName} needs your input for {taskName}",
  "Notifications.Task.approvalRequired":
    "{coworkerName} needs your approval for {taskName}",
  "Notifications.Task.authenticationRequired":
    "{coworkerName} needs authentication for {taskName}",
  "Notifications.Task.outOfCredits":
    "{coworkerName} ran out of credits for {taskName}",
  "Notifications.Task.completed": "{coworkerName} completed {taskName}",
  "Notifications.Task.failed": "{coworkerName} failed to complete {taskName}",
  "Notifications.Task.canceled": "{taskName} was canceled",
  "Notifications.Chat.mentioned": "{authorName} mentioned you in {roomName}",
  "Notifications.Chat.directMessage": "{authorName} sent you a message",
  "notifications.vendorGrant.pending":
    "{vendorName} requested vendor access to your workspace",
};

const PARAM_PATTERN = /\{(\w+)\}/g;

/**
 * Interpolate an English push body for a notification message key.
 * Unknown keys fall back to the messageKey, then "New notification".
 */
export function formatPushNotificationBody(
  messageKey: string,
  messageParams: Record<string, unknown> = {},
): string {
  const template = PUSH_NOTIFICATION_BODY_TEMPLATES[messageKey];
  if (!template) {
    return messageKey.trim() !== "" ? messageKey : "New notification";
  }

  return template.replace(PARAM_PATTERN, (_match, paramName: string) => {
    const value = messageParams[paramName];
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
  });
}
