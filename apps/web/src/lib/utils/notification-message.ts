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
 * one-message key, because the OS banner renders from the same row and is
 * about the message that has just arrived. Here, where the row is a line in a
 * list of what happened, the count is the line.
 */
function countedMessageKey(
  messageKey: string,
  messageParams: Record<string, unknown>,
): string {
  if (messageKey !== CHAT_ROOM_MESSAGE_MESSAGE_KEY) {
    return messageKey;
  }

  const count = messageParams.count;

  return typeof count === "number" && count > 1
    ? CHAT_ROOM_MESSAGES_MESSAGE_KEY
    : messageKey;
}

export function getNotificationMessageTranslationKey(
  messageKey: string,
  messageParams: Record<string, unknown> = {},
): string {
  const counted = countedMessageKey(messageKey, messageParams);

  if (counted.startsWith("Notifications.")) {
    return `Library.${counted}`;
  }

  return counted;
}

export function useNotificationMessage() {
  const t = useTranslations();

  return useCallback(
    (messageKey: string, messageParams: Record<string, unknown> = {}) => {
      try {
        return t(
          getNotificationMessageTranslationKey(
            messageKey,
            messageParams,
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
