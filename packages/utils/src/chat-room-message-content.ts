/**
 * Max human POST/PATCH room-message `content` length (JS string length /
 * Zod `.max()`). Postgres TEXT and Ably (ADR 0014 id envelopes) do not need
 * this; the bound exists so a client cannot POST unbounded strings into
 * mention parse, unfurl, and markdown render. Assistant rows persist via
 * Prisma and are not subject to this Zod max.
 */
export const CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH = 10_000;

/**
 * Composer shows `count/max` from this length through over-limit (bottom
 * right, next to Send). Hidden below so ordinary short messages stay clean.
 */
export const CHAT_ROOM_MESSAGE_CONTENT_COUNT_VISIBLE_AT = 9_500;

/** Core/Zod copy when human create/update content exceeds the max. */
export const CHAT_ROOM_MESSAGE_CONTENT_TOO_LONG_MESSAGE = `Message is too long (maximum ${CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH} characters). Shorten it to send.`;
