export const CHAT_MENTION_MESSAGE_KEY = "Notifications.Chat.mentioned";

export const CHAT_DIRECT_MESSAGE_MESSAGE_KEY =
  "Notifications.Chat.directMessage";

export const CHAT_ROOM_MESSAGE_MESSAGE_KEY = "Notifications.Chat.roomMessage";

/**
 * Keys web renders a count under; Core never stores them. Core stores one key
 * per message.
 */
export const CHAT_ROOM_MESSAGES_MESSAGE_KEY = "Notifications.Chat.roomMessages";

/**
 * Direct-room mention. The room is named after the author, so the catalog
 * names the kind of room instead of repeating them.
 */
export const CHAT_MENTION_DIRECT_MESSAGE_KEY =
  "Notifications.Chat.mentionedDirect";

export const CHAT_ROOM_MESSAGE_GROUP_MESSAGE_KEY =
  "Notifications.Chat.roomMessageGroup";

export const CHAT_ROOM_MESSAGES_GROUP_MESSAGE_KEY =
  "Notifications.Chat.roomMessagesGroup";

export const CHAT_DIRECT_MESSAGES_MESSAGE_KEY =
  "Notifications.Chat.directMessages";

// Banner titles: Core never stores these. The OS already prints the app name,
// so the title is shorter than the feed line.

export const CHAT_ROOM_MESSAGE_TITLE_MESSAGE_KEY =
  "Notifications.Chat.roomMessageTitle";

export const CHAT_ROOM_MESSAGE_GROUP_TITLE_MESSAGE_KEY =
  "Notifications.Chat.roomMessageGroupTitle";

/**
 * Localized word a preview shows for `@all`. Core stores the neutral `@all`;
 * each surface swaps in this word.
 */
export const CHAT_MENTION_ALL_LABEL_MESSAGE_KEY =
  "Notifications.Chat.mentionAll";
