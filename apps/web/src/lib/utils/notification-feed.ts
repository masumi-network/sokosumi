import {
  NotificationKind,
  type NotificationKind as NotificationKindValue,
} from "@/lib/clients/generated/core";

/**
 * Kinds that use browser OS alerts / room attention but stay out of the
 * in-app notification center. Keep in sync with Core
 * `BROWSER_ONLY_NOTIFICATION_KINDS` in `apps/core/src/helpers/notification-feed.ts`.
 */
export const BROWSER_ONLY_NOTIFICATION_KINDS = [
  NotificationKind.CHAT,
] as const satisfies readonly NotificationKindValue[];

export function isBrowserOnlyNotificationKind(
  kind: NotificationKindValue,
): boolean {
  return (
    BROWSER_ONLY_NOTIFICATION_KINDS as readonly NotificationKindValue[]
  ).includes(kind);
}
