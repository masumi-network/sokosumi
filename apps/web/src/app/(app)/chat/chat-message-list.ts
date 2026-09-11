/**
 * Which message list a node belongs to.
 *
 * Its own module rather than an addition to `components/room-helpers.ts`, which
 * is already past the repo's file ceiling, and because the room's loading shell
 * needs the marker alone: importing it from `room-helpers` would pull that
 * module, `@sokosumi/utils` and the mention parser into the instant loading
 * chunk for the sake of one string. `chat-message-list-scroller.ts` beside this
 * file is the same pattern.
 */

/**
 * Marks a message list and says which one it is.
 *
 * The value is new; the attribute is not. `globals.css` scopes the jump
 * spotlight with a bare `[data-chat-message-list]`, which matches whatever the
 * value is, so naming the two lists costs that nothing. It is needed because
 * the room transcript and the open thread render the same message ids, and a
 * document-wide lookup for one of them can land on either.
 */
export const CHAT_MESSAGE_LIST_ATTRIBUTE = "data-chat-message-list";
export const CHAT_MESSAGE_LIST_ROOM = "room";
export const CHAT_MESSAGE_LIST_THREAD = "thread";
