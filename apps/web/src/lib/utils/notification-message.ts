"use client";

import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGES_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_GROUP_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  CHAT_ROOM_MESSAGES_GROUP_MESSAGE_KEY,
  CHAT_ROOM_MESSAGES_MESSAGE_KEY,
} from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

/** Whole messages only, so "1.5 messages in Design" cannot be rendered. */
function countsMany(count: unknown): boolean {
  return typeof count === "number" && Number.isInteger(count) && count > 1;
}

/**
 * The key a chat notification reads under once it stands for several messages.
 *
 * Both surfaces that collapse chat ask this. The notification center counts a
 * room's messages onto one row; an OS banner holds one room and says how many
 * arrivals it has taken. Core stores one key per message either way, so the
 * line for the group is picked here rather than written there.
 *
 * A room of three or more people has no name but the list of who is in it, so
 * "Ada, Ben, Cara" alone reads as three people rather than as somewhere a
 * message was written. Named as a group, it reads as a place. Only a room
 * message is stored with `isGroup`, so a banner that ends on a mention names
 * the room the way that mention was stored.
 *
 * A direct room is named after the other person, so its count names the sender
 * instead: "3 messages in Ada" would read as a place.
 */
function countedMessageKey(
  messageKey: string,
  messageParams: Record<string, unknown>,
): string {
  const group = messageParams.isGroup === true;

  if (!countsMany(messageParams.count)) {
    return messageKey === CHAT_ROOM_MESSAGE_MESSAGE_KEY && group
      ? CHAT_ROOM_MESSAGE_GROUP_MESSAGE_KEY
      : messageKey;
  }

  if (messageKey === CHAT_DIRECT_MESSAGE_MESSAGE_KEY) {
    return CHAT_DIRECT_MESSAGES_MESSAGE_KEY;
  }

  if (
    messageKey === CHAT_MENTION_MESSAGE_KEY ||
    messageKey === CHAT_ROOM_MESSAGE_MESSAGE_KEY
  ) {
    return group
      ? CHAT_ROOM_MESSAGES_GROUP_MESSAGE_KEY
      : CHAT_ROOM_MESSAGES_MESSAGE_KEY;
  }

  return messageKey;
}

export function getNotificationMessageTranslationKey(
  messageKey: string,
  messageParams: Record<string, unknown> = {},
): string {
  const key = countedMessageKey(messageKey, messageParams);

  if (key.startsWith("Notifications.")) {
    return `Library.${key}`;
  }

  return key;
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
