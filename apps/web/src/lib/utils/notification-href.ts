import type { NotificationKind } from "@/lib/clients/generated/core";
import {
  buildCoworkerAccessReviewHref,
  resolveCoworkerAccessNotificationTarget,
} from "@/lib/utils/coworker-access-notification";
import { buildVendorGrantReviewHref } from "@/lib/utils/vendor-grant-approval";
import { resolveVendorGrantNotificationTarget } from "@/lib/utils/vendor-grant-notification";

/**
 * Names the message a chat notification is about, on the room's own URL.
 *
 * Built here and read by the room client, so the two never disagree about
 * what the parameter is called.
 */
export const CHAT_MESSAGE_PARAM = "message";

interface NotificationHrefItem {
  kind: NotificationKind;
  referenceId: string;
  metadata: Record<string, unknown> | null;
  messageKey?: string;
}

/**
 * Get the href for a notification based on its kind and metadata.
 * Uses the same routing logic as History for consistency.
 */
export function getNotificationHref(
  notification: NotificationHrefItem,
): string | null {
  switch (notification.kind) {
    case "TASK":
      return `/tasks/${encodeURIComponent(notification.referenceId)}`;

    case "JOB": {
      const agentId = notification.metadata?.agentId;
      if (!agentId || typeof agentId !== "string") {
        return "/tasks";
      }
      return `/agents/${encodeURIComponent(agentId)}/jobs/${encodeURIComponent(notification.referenceId)}`;
    }

    case "CHAT": {
      const room = `/chat/rooms/${encodeURIComponent(notification.referenceId)}`;
      const messageId = notification.metadata?.messageId;
      // A room notification is about one message in it. Without the message
      // the reader lands at the bottom of the room and scrolls back to find
      // what they were just told about. Rows written before this shipped
      // carry no message id and still open the room.
      if (typeof messageId !== "string" || messageId.length === 0) {
        return room;
      }
      return `${room}?${CHAT_MESSAGE_PARAM}=${encodeURIComponent(messageId)}`;
    }

    case "SYSTEM": {
      if (notification.messageKey) {
        const vendorTarget = resolveVendorGrantNotificationTarget({
          messageKey: notification.messageKey,
          referenceId: notification.referenceId,
          metadata: notification.metadata,
        });
        if (vendorTarget) {
          return (
            buildVendorGrantReviewHref({
              organizationId: vendorTarget.organizationId,
            }) ?? `/`
          );
        }

        const coworkerTarget = resolveCoworkerAccessNotificationTarget({
          messageKey: notification.messageKey,
          referenceId: notification.referenceId,
          metadata: notification.metadata,
        });
        if (coworkerTarget) {
          return (
            buildCoworkerAccessReviewHref({
              organizationId: coworkerTarget.organizationId,
              organizationSlug: coworkerTarget.organizationSlug,
            }) ?? `/`
          );
        }
      }
      return `/`;
    }

    case "BILLING":
      return `/`;

    default: {
      const _exhaustive: never = notification.kind;
      void _exhaustive;
      return `/`;
    }
  }
}
