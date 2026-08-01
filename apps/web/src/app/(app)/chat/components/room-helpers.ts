import { buildQuoteSnippet } from "@sokosumi/utils";
import type {
  ChatRoom,
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  ChatRoomPresence,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { parseMentions } from "@/lib/utils/mention-parser";

export interface DirectParticipantPreview {
  id: string;
  name: string;
  detail: string | null;
  image: string | null;
  presence: ChatRoomPresence;
  kind: "human" | "coworker";
}

export interface RoomParticipantPreview {
  id: string;
  name: string;
  image: string | null;
  presence: ChatRoomPresence;
  kind: "human" | "coworker";
}

/** Catalog / chip key for room-wide @all. Not a user UUID. */
export const ROOM_MENTION_ALL_ID = "all" as const;

/** Slug half of the persist token `@all:all`. */
export const ROOM_MENTION_ALL_SLUG = "all" as const;

/** Persist form written by the wysiwyg serializer (`@key:slug`). */
export const ROOM_MENTION_ALL_TOKEN = "@all:all" as const;

/** Bare form accepted when users type/paste without the `:slug` suffix. */
export const ROOM_MENTION_ALL_BARE = "@all" as const;

export function isRoomMentionAllId(id: string): boolean {
  return id === ROOM_MENTION_ALL_ID;
}

/** Shared mention-picker payload for humans, coworkers, and synthetic @all. */
export interface RoomMentionParticipant {
  kind: "human" | "coworker" | "all";
  id: string;
  name: string;
  slug: string;
  image: string | null;
}

/** Synthetic catalog row for the @all picker entry. */
export function buildRoomAllMentionRecord(): {
  value: string;
  slug: string;
  data: RoomMentionParticipant;
} {
  return {
    value: ROOM_MENTION_ALL_ID,
    slug: ROOM_MENTION_ALL_SLUG,
    data: {
      kind: "all",
      id: ROOM_MENTION_ALL_ID,
      name: ROOM_MENTION_ALL_ID,
      slug: ROOM_MENTION_ALL_SLUG,
      image: null,
    },
  };
}

export function appendComposerBlock(value: string, block: string): string {
  if (!value.trim()) {
    return block;
  }

  const trimmedRight = value.trimEnd();
  return `${trimmedRight}\n${block}`;
}

/**
 * Build POST message content from composer text + attachment chips.
 * Chips stay out of the textarea; markdown links are appended on send.
 */
export function buildRoomComposerMessageContent(
  value: string,
  attachments: readonly { fileName: string; url: string }[],
  formatAttachmentMarkdown: (fileName: string, url: string) => string,
): string {
  const text = value.trimEnd();
  if (attachments.length === 0) {
    return text.trim();
  }

  const attachmentMarkdown = attachments
    .map((attachment) =>
      formatAttachmentMarkdown(attachment.fileName, attachment.url),
    )
    .join("");

  if (!text.trim()) {
    return attachmentMarkdown.trimEnd();
  }

  return appendComposerBlock(text, attachmentMarkdown).trimEnd();
}

export function isRoomComposerEmpty(
  value: string,
  attachments: readonly unknown[],
): boolean {
  return value.trim().length === 0 && attachments.length === 0;
}

export function hasPendingCoworkerMention(
  messages: ChatRoomMessage[],
): boolean {
  return messages.some((message) =>
    message.mentions.some(
      (mention) => mention.status === "pending" || mention.status === "sent",
    ),
  );
}

export function appendMessage(
  messages: ChatRoomMessage[],
  nextMessage: ChatRoomMessage,
): ChatRoomMessage[] {
  if (messages.some((message) => message.id === nextMessage.id)) {
    return messages;
  }
  return [...messages, nextMessage];
}

export function toggleId(
  ids: string[],
  id: string,
  checked: boolean,
): string[] {
  if (checked) {
    return ids.includes(id) ? ids : [...ids, id];
  }
  return ids.filter((item) => item !== id);
}

/** Slack-like gap before a same-sender burst starts a new full header. */
export const MESSAGE_GROUP_GAP_MS = 5 * 60 * 1000;

/** Pending composer quote (author + snippet snapshot for the dismissible chip). */
export interface PendingRoomQuote {
  messageId: string;
  authorName: string;
  snippet: string;
}

export function pendingQuoteFromMessage(
  message: ChatRoomMessage,
): PendingRoomQuote {
  return {
    messageId: message.id,
    authorName: messageSender(message).name,
    snippet: buildQuoteSnippet(message.content),
  };
}

/** Soft-fail scroll to a room message article when it is still in the DOM. */
export function scrollToRoomMessageElement(messageId: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const target = document.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  );
  if (!target) {
    return false;
  }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

export function messageSender(message: ChatRoomMessage) {
  if (message.sender.type === "user") {
    return {
      name: message.sender.user.name,
      image: message.sender.user.image,
      kind: "human" as const,
    };
  }
  if (message.sender.type === "coworker") {
    return {
      name: message.sender.coworker.name,
      image: message.sender.coworker.image,
      kind: "coworker" as const,
    };
  }
  return {
    name: "Unknown",
    image: null,
    kind: "unknown" as const,
  };
}

/** Stable sender identity for grouping; null when identity is unknown. */
export function messageSenderKey(message: ChatRoomMessage): string | null {
  if (message.sender.type === "user") {
    return `user:${message.sender.user.id}`;
  }
  if (message.sender.type === "coworker") {
    return `coworker:${message.sender.coworker.id}`;
  }
  return null;
}

/**
 * True when `current` should render as a Slack-style continuation of `previous`
 * (omit avatar / name / primary timestamp).
 */
export function isMessageContinuation(
  previous: ChatRoomMessage | undefined,
  current: ChatRoomMessage,
  options?: { gapMs?: number },
): boolean {
  if (!previous) {
    return false;
  }

  const previousKey = messageSenderKey(previous);
  const currentKey = messageSenderKey(current);
  if (!previousKey || !currentKey || previousKey !== currentKey) {
    return false;
  }

  if (messageDayKey(previous.createdAt) !== messageDayKey(current.createdAt)) {
    return false;
  }

  const gapMs = options?.gapMs ?? MESSAGE_GROUP_GAP_MS;
  const previousTime = new Date(previous.createdAt).getTime();
  const currentTime = new Date(current.createdAt).getTime();
  if (
    !Number.isFinite(previousTime) ||
    !Number.isFinite(currentTime) ||
    currentTime < previousTime ||
    currentTime - previousTime >= gapMs
  ) {
    return false;
  }

  return true;
}

export function formatMessageTime(value: Date | string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function messageDayKey(value: Date | string): string {
  return new Date(value).toDateString();
}

/**
 * Day separators are derived from the local date, so a message written near
 * midnight can land in a different bucket on the server than in the browser.
 * The separator text itself is marked as client-resolved for the same reason
 * the timestamps are.
 */

export function getDirectRoomTarget(room: ChatRoom, currentUserId: string) {
  return (
    room.userMembers.find((member) => member.id !== currentUserId) ??
    room.userMembers[0] ??
    null
  );
}

export function getDirectRoomParticipants(
  room: ChatRoom,
  currentUserId: string,
): DirectParticipantPreview[] {
  return [
    ...room.userMembers
      .filter((member) => member.id !== currentUserId)
      .map((member) => ({
        id: member.id,
        name: member.name || member.email,
        detail: member.email,
        image: member.image,
        presence: member.presence,
        kind: "human" as const,
      })),
    ...room.coworkerMembers.map((coworker) => ({
      id: coworker.id,
      name: coworker.name,
      detail: coworker.caption,
      image: coworker.image,
      presence: coworker.presence,
      kind: "coworker" as const,
    })),
  ];
}

/**
 * Coworker 1:1 DM — room stream owns the assistant reply (not mention POST).
 * Matches Core skip-mention: exactly one user + one coworker.
 */
export function isCoworkerOnlyDirectRoom(room: {
  kind: string;
  userMembers: { id?: string; userId?: string }[];
  coworkerMembers: { id?: string; coworkerId?: string }[];
}): boolean {
  return (
    room.kind === "direct" &&
    room.coworkerMembers.length === 1 &&
    room.userMembers.length === 1
  );
}

/**
 * Main composer: coworker 1:1 uses room stream; everyone else message POST.
 * rooms-client must call this (not invent a second predicate).
 */
export function shouldUseCoworkerRoomStream(room: {
  kind: string;
  userMembers: { id?: string; userId?: string }[];
  coworkerMembers: { id?: string; coworkerId?: string }[];
}): boolean {
  return isCoworkerOnlyDirectRoom(room);
}

/**
 * Thread chrome on room messages.
 * Stream overlays never show threads (ephemeral stream ids).
 */
export function shouldShowChatRoomThreadButton(options: {
  room: {
    kind: string;
    userMembers: { id?: string; userId?: string }[];
    coworkerMembers: { id?: string; coworkerId?: string }[];
  };
  isStreamOverlay: boolean;
}): boolean {
  if (options.isStreamOverlay) return false;
  return true;
}

/** Direct rooms: @ only when the roster has more than two people (incl. you). */
export function shouldShowRoomMentionShortcut(room: {
  kind: string;
  userMembers: readonly unknown[];
  coworkerMembers: readonly unknown[];
}): boolean {
  if (room.kind !== "direct") {
    return true;
  }
  return room.userMembers.length + room.coworkerMembers.length > 2;
}

/**
 * Offer @all when mentions already work and at least one other human can be
 * notified (room humans excluding the author).
 */
export function shouldIncludeRoomAllMention(
  room: {
    kind: string;
    userMembers: ReadonlyArray<{ id: string }>;
    coworkerMembers: readonly unknown[];
  },
  currentUserId: string,
): boolean {
  if (!shouldShowRoomMentionShortcut(room)) {
    return false;
  }
  return room.userMembers.some((member) => member.id !== currentUserId);
}

export function formatDirectParticipantNames(
  participants: DirectParticipantPreview[],
  fallback: string,
): string {
  if (participants.length === 0) {
    return fallback;
  }

  const names = participants.map((participant) => participant.name);
  if (names.length <= 3) {
    return names.join(", ");
  }

  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

export function getRoomDisplayName(
  room: ChatRoom,
  currentUserId: string,
): string {
  if (room.kind !== "direct") {
    return room.name;
  }
  return formatDirectParticipantNames(
    getDirectRoomParticipants(room, currentUserId),
    getDirectRoomTarget(room, currentUserId)?.name || room.name,
  );
}

export function getRoomParticipantPreviews(
  room: ChatRoom,
): RoomParticipantPreview[] {
  return [
    ...room.userMembers.map((member) => ({
      id: member.id,
      name: member.name || member.email,
      image: member.image,
      presence: member.presence,
      kind: "human" as const,
    })),
    ...room.coworkerMembers.map((coworker) => ({
      id: coworker.id,
      name: coworker.name,
      image: coworker.image,
      presence: coworker.presence,
      kind: "coworker" as const,
    })),
  ];
}

export function presenceLabel(
  t: (key: "Presence.online" | "Presence.afk" | "Presence.offline") => string,
  presence: ChatRoomPresence,
): string {
  if (presence === "online") {
    return t("Presence.online");
  }
  if (presence === "afk") {
    return t("Presence.afk");
  }
  return t("Presence.offline");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatRoomMarkdownMentions({
  content,
  coworkersById,
  coworkersBySlug,
  usersById,
  usersBySlug,
}: {
  content: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  usersById?: Map<string, Pick<ChatRoomUserParticipant, "id" | "name">>;
  usersBySlug?: Map<string, Pick<ChatRoomUserParticipant, "id" | "name">>;
}): string {
  const matches = parseMentions(content);
  if (matches.length === 0) {
    return content;
  }

  let formatted = "";
  let lastIndex = 0;
  for (const match of matches) {
    if (match.start > lastIndex) {
      formatted += content.slice(lastIndex, match.start);
    }
    const displayName = isRoomMentionAllId(match.id)
      ? ROOM_MENTION_ALL_ID
      : ((coworkersById.get(match.id) ?? coworkersBySlug.get(match.slug))
          ?.name ??
        (usersById?.get(match.id) ?? usersBySlug?.get(match.slug))?.name);
    if (displayName) {
      formatted += `<span class="text-primary font-medium">${escapeHtml(`@${displayName}`)}</span>`;
    } else {
      formatted += content.slice(match.start, match.end);
    }
    lastIndex = match.end;
  }
  if (lastIndex < content.length) {
    formatted += content.slice(lastIndex);
  }

  return formatted;
}
