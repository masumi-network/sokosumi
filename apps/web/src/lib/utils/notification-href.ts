import type { NotificationKind } from "@/lib/clients/generated/core";
import {
  buildCoworkerAccessReviewHref,
  resolveCoworkerAccessNotificationTarget,
} from "@/lib/utils/coworker-access-notification";
import { buildVendorGrantReviewHref } from "@/lib/utils/vendor-grant-approval";
import { resolveVendorGrantNotificationTarget } from "@/lib/utils/vendor-grant-notification";

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

    case "CHAT":
      return `/chat/rooms/${encodeURIComponent(notification.referenceId)}`;

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
