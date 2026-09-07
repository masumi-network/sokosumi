"use client";

import {
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  CHAT_ROOM_MESSAGES_MESSAGE_KEY,
} from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

/**
 * The key a row uses once it stands for more than one message.
 *
 * A reader following a room gets one row for it, and Core counts the messages
 * onto that row rather than writing twenty. The stored key stays the
 * one-message key, because a banner is about the message that has just
 * arrived. Here, where the row is a line in a list of what happened, the count
 * is the line.
 */
function countedMessageKey(
  messageKey: string,
  messageParams: Record<string, unknown>,
): string {
  if (messageKey !== CHAT_ROOM_MESSAGE_MESSAGE_KEY) {
    return messageKey;
  }

  const count = messageParams.count;

  // Whole messages only. The count is JSON some Core build wrote, and
  // "1.5 messages in Design" is worse than the line it replaces.
  return typeof count === "number" && Number.isInteger(count) && count > 1
    ? CHAT_ROOM_MESSAGES_MESSAGE_KEY
    : messageKey;
}

/** Whether to read a row that stands for several messages as a count. */
export interface NotificationMessageOptions {
  /**
   * False for a banner. A banner interrupts because a message just arrived,
   * so it says that message rather than the tally of the room, and it says the
   * same thing whether the tab was open (this path) or closed (the push
   * service worker, which renders the stored key and knows nothing of counts).
   */
  counted?: boolean;
}

export function getNotificationMessageTranslationKey(
  messageKey: string,
  messageParams: Record<string, unknown> = {},
  { counted = true }: NotificationMessageOptions = {},
): string {
  const key = counted
    ? countedMessageKey(messageKey, messageParams)
    : messageKey;

  if (key.startsWith("Notifications.")) {
    return `Library.${key}`;
  }

  return key;
}

export function useNotificationMessage() {
  const t = useTranslations();

  return useCallback(
    (
      messageKey: string,
      messageParams: Record<string, unknown> = {},
      options: NotificationMessageOptions = {},
    ) => {
      try {
        return t(
          getNotificationMessageTranslationKey(
            messageKey,
            messageParams,
            options,
          ) as never,
          messageParams as never,
        );
      } catch {
        return messageKey;
      }
    },
    [t],
  );
}
