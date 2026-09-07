/**
 * The message keys Core stores on a chat notification.
 *
 * Both apps read them. Core writes them and asks which preference row a key
 * belongs to; web decides from them whether a stored row reaches the
 * notification center. Plain strings, because the other half of each one is a
 * catalog entry under `Library.Notifications.Chat` that neither app owns.
 */

/** The reader was named in the message. */
export const CHAT_MENTION_MESSAGE_KEY = "Notifications.Chat.mentioned";

/** The message arrived in a room of two, so it was addressed to the reader. */
export const CHAT_DIRECT_MESSAGE_MESSAGE_KEY =
  "Notifications.Chat.directMessage";

/** One message in a room, for a reader who asked to hear about every one. */
export const CHAT_ROOM_MESSAGE_MESSAGE_KEY = "Notifications.Chat.roomMessage";

/**
 * The same row once more messages have landed on it, counting them.
 *
 * A room the reader is following can carry twenty messages in a minute, and
 * twenty rows would be the whole notification center. The row the first
 * message wrote takes the rest, and says how many.
 */
export const CHAT_ROOM_MESSAGES_MESSAGE_KEY = "Notifications.Chat.roomMessages";

/** Both faces of the room-message row: the first message, and the count. */
export const CHAT_ROOM_MESSAGE_KEYS: readonly string[] = [
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  CHAT_ROOM_MESSAGES_MESSAGE_KEY,
];
