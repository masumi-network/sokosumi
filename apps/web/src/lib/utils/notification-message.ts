"use client";

import {
  CHAT_ROOM_MESSAGE_GROUP_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  CHAT_ROOM_MESSAGES_GROUP_MESSAGE_KEY,
  CHAT_ROOM_MESSAGES_MESSAGE_KEY,
} from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

/**
 * The key the notification center reads a room-message row under.
 *
 * Core stores one key for every message in a room, and this picks the line the
 * feed shows for the row as it stands: how many messages have landed on it,
 * and whether the room has a name of its own.
 *
 * A room of three or more people has no name but the list of who is in it, so
 * "Ada, Ben, Cara" alone reads as three people rather than as somewhere a
 * message was written. Named as a group, it reads as a place.
 *
 * Only the feed asks for this. A banner is about the message that has just
 * arrived, and the push service worker renders the stored key for a tab that
 * was closed; both say the same thing because both take the stored key.
 */
function feedMessageKey(
  messageKey: string,
  messageParams: Record<string, unknown>,
): string {
  if (messageKey !== CHAT_ROOM_MESSAGE_MESSAGE_KEY) {
    return messageKey;
  }

  const count = messageParams.count;
  // Whole messages only. The count is JSON some Core build wrote, and
  // "1.5 messages in Design" is worse than the line it replaces.
  const many =
    typeof count === "number" && Number.isInteger(count) && count > 1;
  const group = messageParams.isGroup === true;

  if (many) {
    return group
      ? CHAT_ROOM_MESSAGES_GROUP_MESSAGE_KEY
      : CHAT_ROOM_MESSAGES_MESSAGE_KEY;
  }

  return group ? CHAT_ROOM_MESSAGE_GROUP_MESSAGE_KEY : messageKey;
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
  const key = counted ? feedMessageKey(messageKey, messageParams) : messageKey;

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
