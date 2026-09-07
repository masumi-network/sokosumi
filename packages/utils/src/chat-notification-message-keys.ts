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
 * The keys web renders a room-message row under, which Core never stores.
 *
 * The stored key is always `CHAT_ROOM_MESSAGE_MESSAGE_KEY`: a banner is about
 * the message that has just arrived, and the push service worker renders the
 * stored key with no view of the row's history. The notification center is the
 * one surface where the row is a line in a list of what happened, so it is the
 * one that reads the row as a count, and as a group of people when the room
 * has no name of its own.
 */

/** The row once more than one message has landed on it. */
export const CHAT_ROOM_MESSAGES_MESSAGE_KEY = "Notifications.Chat.roomMessages";

/** One message, in a room whose name is the list of who is in it. */
export const CHAT_ROOM_MESSAGE_GROUP_MESSAGE_KEY =
  "Notifications.Chat.roomMessageGroup";

/** Several messages, in a room whose name is the list of who is in it. */
export const CHAT_ROOM_MESSAGES_GROUP_MESSAGE_KEY =
  "Notifications.Chat.roomMessagesGroup";

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
