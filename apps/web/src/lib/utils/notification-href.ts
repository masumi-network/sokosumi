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
 * Get the href for a notification based on its kind and metadata. Uses the
 * same routing logic as History for consistency.
 *
 * Always a destination. Every kind ends in a path, and a kind with nothing of
 * its own to open resolves to the home page rather than to nothing, so no
 * caller has to decide what an absent href means.
 */
export function getNotificationHref(
  notification: NotificationHrefItem,
): string {
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
      // what they were just told about. A row carrying no message id still
      // opens the room. Core requires a message id on every chat notification
      // it writes (`chat-notification-fanout.ts`), so this branch answers for
      // the optional metadata type rather than for a shape that path emits.
      //
      // Trimmed so the room is the destination for a blank id and the URL
      // carries the id the room will look for. The room trims what it reads
      // as well, so the two agree and neither has to guess.
      const trimmedMessageId =
        typeof messageId === "string" ? messageId.trim() : "";
      if (trimmedMessageId.length === 0) {
        return room;
      }
      return `${room}?${CHAT_MESSAGE_PARAM}=${encodeURIComponent(trimmedMessageId)}`;
    }

    case "SYSTEM": {
      if (notification.messageKey) {
        const vendorTarget = resolveVendorGrantNotificationTarget({
          messageKey: notification.messageKey,
          referenceId: notification.referenceId,
          metadata: notification.metadata,
        });
        if (vendorTarget) {
          return buildVendorGrantReviewHref({
            organizationId: vendorTarget.organizationId,
          });
        }

        const coworkerTarget = resolveCoworkerAccessNotificationTarget({
          messageKey: notification.messageKey,
          referenceId: notification.referenceId,
          metadata: notification.metadata,
        });
        if (coworkerTarget) {
          return buildCoworkerAccessReviewHref({
            organizationId: coworkerTarget.organizationId,
            organizationSlug: coworkerTarget.organizationSlug,
          });
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
