import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_GROUP_TITLE_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_TITLE_MESSAGE_KEY,
} from "@sokosumi/utils";

/** What an OS banner shows: a bold first line, and text under it. */
export interface NotificationBannerContent {
  title: string;
  body: string;
}

export interface NotificationBannerInput {
  messageKey: string;
  messageParams: Record<string, unknown>;
  /** The app name, which every notification but a chat one is titled with. */
  appTitle: string;
  /** Renders a stored key with its params, the way the app renders it. */
  translate: (messageKey: string) => string;
}

/**
 * The banner title for a chat message, or null when the key is not one.
 *
 * Every chat title names the author, so a message with no author to name has
 * no title to give. A direct message needs no catalog string beyond that: the
 * title is the author, and a person's name is the same in every language.
 */
function chatTitle(
  messageKey: string,
  messageParams: Record<string, unknown>,
  translate: (messageKey: string) => string,
): string | null {
  const authorName = messageParams.authorName;
  if (typeof authorName !== "string" || !authorName) {
    return null;
  }

  if (messageKey === CHAT_DIRECT_MESSAGE_MESSAGE_KEY) {
    return authorName;
  }

  if (
    (messageKey === CHAT_MENTION_MESSAGE_KEY ||
      messageKey === CHAT_ROOM_MESSAGE_MESSAGE_KEY) &&
    (typeof messageParams.roomName !== "string" ||
      !messageParams.roomName.trim())
  ) {
    return authorName;
  }

  if (messageKey === CHAT_MENTION_MESSAGE_KEY) {
    return translate(messageKey);
  }

  if (messageKey === CHAT_ROOM_MESSAGE_MESSAGE_KEY) {
    return translate(
      messageParams.isGroup === true
        ? CHAT_ROOM_MESSAGE_GROUP_TITLE_MESSAGE_KEY
        : CHAT_ROOM_MESSAGE_TITLE_MESSAGE_KEY,
    );
  }

  return null;
}

/**
 * What one notification puts on an OS banner.
 *
 * A chat message is titled with who wrote and where, and the message itself
 * goes underneath. The operating system prints the app name beside the banner
 * already, so spending the title on it costs the reader the one line they can
 * judge the message from.
 *
 * Every other kind keeps the app name and its line, because a title is cut
 * shorter than a body on most platforms and a task name is long. Chat
 * messages without preview text keep their chat title and have no body.
 * Grouped arrivals use the app title and the room's count instead of a preview.
 *
 * The push service worker renders a closed tab's banner and cannot import this
 * (it ships as a plain script), so it carries the same rule. The two are held
 * together by tests on both sides.
 */
export function buildNotificationBannerContent({
  messageKey,
  messageParams,
  appTitle,
  translate,
}: NotificationBannerInput): NotificationBannerContent {
  const count = messageParams.count;
  if (
    typeof count === "number" &&
    Number.isInteger(count) &&
    count > 1 &&
    (messageKey === CHAT_DIRECT_MESSAGE_MESSAGE_KEY ||
      messageKey === CHAT_MENTION_MESSAGE_KEY ||
      messageKey === CHAT_ROOM_MESSAGE_MESSAGE_KEY)
  ) {
    // A grouped banner speaks for the room; a preview describes one arrival.
    return { title: appTitle, body: translate(messageKey) };
  }
  const preview = messageParams.messagePreview;

  const title = chatTitle(messageKey, messageParams, translate);
  if (title !== null) {
    return { title, body: typeof preview === "string" ? preview : "" };
  }

  return { title: appTitle, body: translate(messageKey) };
}
