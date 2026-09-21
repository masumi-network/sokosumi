import {
  BILLING_PAYMENT_FAILED_MESSAGE_KEY,
  BILLING_SUBSCRIPTION_ENDING_MESSAGE_KEY,
} from "@sokosumi/utils";

import type { NotificationKind } from "@/lib/clients/generated/core";
import {
  buildWorkspaceApprovalReviewHref,
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  COWORKER_ACCESS_REVIEW_HASH,
  resolveWorkspaceApprovalNotificationTarget,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
  VENDOR_GRANT_REVIEW_HASH,
} from "@/lib/utils/workspace-approval";

/**
 * Names the message a chat notification is about, on the room's own URL.
 *
 * Built here and read by the room client, so the two never disagree about
 * what the parameter is called.
 */
export const CHAT_MESSAGE_PARAM = "message";

/** In-app href that opens a room and jumps to one message. */
export function chatRoomMessageHref(roomId: string, messageId: string): string {
  const room = `/chat/rooms/${encodeURIComponent(roomId)}`;
  const trimmedMessageId = messageId.trim();
  if (trimmedMessageId.length === 0) {
    return room;
  }
  return `${room}?${CHAT_MESSAGE_PARAM}=${encodeURIComponent(trimmedMessageId)}`;
}

export interface ChatRoomMessageLink {
  roomId: string;
  messageId: string;
}

const CHAT_ROOM_MESSAGE_PATHNAME_RE = /^\/chat\/rooms\/([^/]+)\/?$/;

/**
 * Inverse of `chatRoomMessageHref` for pasted text: matches only when the whole
 * text is one absolute Message link on `origin`.
 */
export function parseChatRoomMessageLink(
  text: string,
  origin: string,
): ChatRoomMessageLink | null {
  const trimmed = text.trim();
  if (/\s/.test(trimmed) || !URL.canParse(trimmed)) {
    return null;
  }
  const url = new URL(trimmed);
  if (url.origin !== origin || url.username || url.password) {
    return null;
  }
  const roomId = CHAT_ROOM_MESSAGE_PATHNAME_RE.exec(url.pathname)?.[1];
  const messageId = url.searchParams.get(CHAT_MESSAGE_PARAM)?.trim();
  if (!roomId || !messageId) {
    return null;
  }
  try {
    return { roomId: decodeURIComponent(roomId), messageId };
  } catch {
    return null;
  }
}

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
      return chatRoomMessageHref(notification.referenceId, trimmedMessageId);
    }

    case "SYSTEM": {
      if (notification.messageKey) {
        const vendorTarget = resolveWorkspaceApprovalNotificationTarget(
          {
            messageKey: notification.messageKey,
            referenceId: notification.referenceId,
            metadata: notification.metadata,
          },
          VENDOR_GRANT_PENDING_MESSAGE_KEY,
        );
        if (vendorTarget) {
          return buildWorkspaceApprovalReviewHref({
            organizationId: vendorTarget.organizationId,
            organizationSlug: vendorTarget.organizationSlug,
            hash: VENDOR_GRANT_REVIEW_HASH,
          });
        }

        const coworkerTarget = resolveWorkspaceApprovalNotificationTarget(
          {
            messageKey: notification.messageKey,
            referenceId: notification.referenceId,
            metadata: notification.metadata,
          },
          COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        );
        if (coworkerTarget) {
          return buildWorkspaceApprovalReviewHref({
            organizationId: coworkerTarget.organizationId,
            organizationSlug: coworkerTarget.organizationSlug,
            hash: COWORKER_ACCESS_REVIEW_HASH,
          });
        }
      }
      return `/`;
    }

    case "BILLING": {
      // The billing page has two tabs, and a notification is about one of
      // them: a payment that failed or a plan that ends is fixed on the
      // subscription tab, and a wallet that ran low or was topped up is
      // read on the credits tab. A key this does not know goes to credits,
      // which is where the balance the reader will look for lives.
      const subscriptionKeys: readonly string[] = [
        BILLING_PAYMENT_FAILED_MESSAGE_KEY,
        BILLING_SUBSCRIPTION_ENDING_MESSAGE_KEY,
      ];
      return notification.messageKey &&
        subscriptionKeys.includes(notification.messageKey)
        ? "/billing?tab=subscription"
        : "/billing?tab=credits";
    }

    default: {
      const _exhaustive: never = notification.kind;
      void _exhaustive;
      return `/`;
    }
  }
}
