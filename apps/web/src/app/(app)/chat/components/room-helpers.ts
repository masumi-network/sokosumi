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

/** Shared mention-picker payload for humans and coworkers in room composers. */
export interface RoomMentionParticipant {
  kind: "human" | "coworker";
  id: string;
  name: string;
  slug: string;
  image: string | null;
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
export function shouldShowRoomMentionShortcut(room: ChatRoom): boolean {
  if (room.kind !== "direct") {
    return true;
  }
  return room.userMembers.length + room.coworkerMembers.length > 2;
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
  matches.forEach((match) => {
    if (match.start > lastIndex) {
      formatted += content.slice(lastIndex, match.start);
    }
    const coworker =
      coworkersById.get(match.id) ?? coworkersBySlug.get(match.slug);
    const user =
      usersById?.get(match.id) ?? usersBySlug?.get(match.slug) ?? undefined;
    const displayName = coworker?.name ?? user?.name ?? match.id;
    formatted += `<span class="text-primary font-medium">${escapeHtml(`@${displayName}`)}</span>`;
    lastIndex = match.end;
  });
  if (lastIndex < content.length) {
    formatted += content.slice(lastIndex);
  }

  return formatted;
}
