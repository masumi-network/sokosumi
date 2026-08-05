/**
 * Notification kinds that still create rows + realtime events (browser OS
 * alerts, chat room attention) but must not appear in the in-app notification
 * center.
 *
 * String literals only — no Prisma or generated Core DTO enums. Consumers
 * narrow against their own NotificationKind types at the package boundary.
 */
export const BROWSER_ONLY_NOTIFICATION_KINDS = ["CHAT"] as const;

export type BrowserOnlyNotificationKind =
  (typeof BROWSER_ONLY_NOTIFICATION_KINDS)[number];

export function isBrowserOnlyNotificationKind(
  kind: string,
): kind is BrowserOnlyNotificationKind {
  return (BROWSER_ONLY_NOTIFICATION_KINDS as readonly string[]).includes(kind);
}
