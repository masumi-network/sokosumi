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
 * The keys web renders a count under, which Core never stores.
 *
 * Core stores one key per message. Two surfaces read several messages as one
 * line: the notification center, where a room's messages are counted onto a
 * single row, and the OS banner, where a room's chat notifications share a
 * banner and the newest one says how many it stands for. A room with no name
 * of its own is named as a group on both.
 */

/** The row once more than one message has landed on it. */
export const CHAT_ROOM_MESSAGES_MESSAGE_KEY = "Notifications.Chat.roomMessages";

/** One message, in a room whose name is the list of who is in it. */
export const CHAT_ROOM_MESSAGE_GROUP_MESSAGE_KEY =
  "Notifications.Chat.roomMessageGroup";

/** Several messages, in a room whose name is the list of who is in it. */
export const CHAT_ROOM_MESSAGES_GROUP_MESSAGE_KEY =
  "Notifications.Chat.roomMessagesGroup";

/** Several messages from the one person a direct room is with. */
export const CHAT_DIRECT_MESSAGES_MESSAGE_KEY =
  "Notifications.Chat.directMessages";
