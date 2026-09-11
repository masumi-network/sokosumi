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

/**
 * One mention, in a direct room of two.
 *
 * Such a room is named after the other person, who in a mention is whoever
 * wrote it. "Ada mentioned you in Ada" names Ada twice and a place not at all,
 * so the reader is told which kind of room it was instead.
 */
export const CHAT_MENTION_DIRECT_MESSAGE_KEY =
  "Notifications.Chat.mentionedDirect";

/** One message, in a room whose name is the list of who is in it. */
export const CHAT_ROOM_MESSAGE_GROUP_MESSAGE_KEY =
  "Notifications.Chat.roomMessageGroup";

/** Several messages, in a room whose name is the list of who is in it. */
export const CHAT_ROOM_MESSAGES_GROUP_MESSAGE_KEY =
  "Notifications.Chat.roomMessagesGroup";

/** Several messages from the one person a direct room is with. */
export const CHAT_DIRECT_MESSAGES_MESSAGE_KEY =
  "Notifications.Chat.directMessages";

// The keys web titles a banner with, which Core never stores. A banner shows
// the message itself, so the line that names the author and the room moves up
// into the title and the words go underneath. The title is shorter than the
// feed line because the operating system already prints the app name beside
// it, and a title truncates before a body does.

/** One message, titled with who wrote and where. */
export const CHAT_ROOM_MESSAGE_TITLE_MESSAGE_KEY =
  "Notifications.Chat.roomMessageTitle";

/** One message, in a room whose name is the list of who is in it. */
export const CHAT_ROOM_MESSAGE_GROUP_TITLE_MESSAGE_KEY =
  "Notifications.Chat.roomMessageGroupTitle";

/**
 * The localized word a preview shows for the room-wide mention (`@all`).
 * Core stores the neutral `@all`; each reader's surface swaps in this word.
 */
export const CHAT_MENTION_ALL_LABEL_MESSAGE_KEY =
  "Notifications.Chat.mentionAll";
