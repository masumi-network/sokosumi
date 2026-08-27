import {
  buildRoomQuoteSnippetParts,
  type ChannelLinkTarget,
  type ChatRoomQuoteAttachment,
  linkifyChannelLinksInMarkdown,
} from "@sokosumi/utils";
import type { ComposerChannelOption } from "@/components/chat/composer-suggestions";
import type {
  MentionSuggestionGroup,
  NormalizedMention,
} from "@/components/ui/mention-textarea-utils";
import type {
  ChatRoom,
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  ChatRoomPresence,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { parseMentions } from "@/lib/utils/mention-parser";
import { chatRoomHref } from "../utils/chat-route-base";

/**
 * Room markdown density: zero default paragraph margin so single-block
 * messages stay tight, but restore vertical gap between consecutive `<p>`
 * nodes so blank lines (`\n\n` after send) stay visible.
 */
export const ROOM_MESSAGE_MARKDOWN_CLASSNAME =
  "text-base! md:text-sm! prose-p:my-0 [&_p+p]:mt-3 prose-p:leading-6 prose-ul:my-1 prose-ol:my-1 prose-pre:my-2";

export const ROOM_QUOTE_MARKDOWN_CLASSNAME =
  "prose-p:my-0 [&_p+p]:mt-2 prose-p:leading-5 prose-ul:my-0 prose-ol:my-0 prose-pre:my-0";

export interface DirectParticipantPreview {
  id: string;
  name: string;
  detail: string | null;
  image: string | null;
  presence: ChatRoomPresence;
  kind: "human" | "coworker";
}

/** Shared hover / roster shape for humans vs AI coworkers in a room. */
export type ChatParticipantHoverProfile =
  | {
      kind: "human";
      id: string;
      name: string;
      email: string;
      image: string | null;
      presence: ChatRoomPresence;
    }
  | {
      kind: "coworker";
      id: string;
      name: string;
      slug: string;
      caption: string | null;
      image: string | null;
      presence: ChatRoomPresence;
    };

export type RoomParticipantPreview = ChatParticipantHoverProfile;

export type MessageSenderProfile =
  | ChatParticipantHoverProfile
  | {
      kind: "unknown";
      name: string;
      image: null;
    };

/** Catalog / chip key for room-wide @all. Not a user UUID. */
export const ROOM_MENTION_ALL_ID = "all" as const;

/** Slug half of the persist token `@all:all`. */
export const ROOM_MENTION_ALL_SLUG = "all" as const;

/** Persist form written by the wysiwyg serializer (`@key:slug`). */
export const ROOM_MENTION_ALL_TOKEN = "@all:all" as const;

export function isRoomMentionAllId(id: string): boolean {
  return id === ROOM_MENTION_ALL_ID;
}

/** Display names for composer hydrate chips. Picker catalog stays separate. */
export function composerMentionDisplayNames({
  usersById,
  usersBySlug,
  coworkersById,
  coworkersBySlug,
  mentionCatalog,
}: {
  usersById?: Map<string, { name: string }>;
  usersBySlug?: Map<string, { name: string }>;
  coworkersById?: Map<string, { name: string }>;
  coworkersBySlug?: Map<string, { name: string }>;
  mentionCatalog?: Record<string, { value?: string; slug?: string | null }>;
}): { byKey: Map<string, string>; bySlug: Map<string, string> } {
  const byKey = new Map<string, string>();
  const bySlug = new Map<string, string>();

  // Catalog first (@all and picker labels), then roster overwrites so
  // hydrate chips match posted quotes. Same win order as quote preview.
  for (const [key, entry] of Object.entries(mentionCatalog ?? {})) {
    if (!entry.value) continue;
    byKey.set(key, entry.value);
    if (entry.slug) {
      bySlug.set(entry.slug, entry.value);
    }
  }
  for (const [id, user] of usersById ?? []) {
    byKey.set(id, user.name);
  }
  for (const [slug, user] of usersBySlug ?? []) {
    bySlug.set(slug, user.name);
  }
  for (const [id, coworker] of coworkersById ?? []) {
    byKey.set(id, coworker.name);
  }
  for (const [slug, coworker] of coworkersBySlug ?? []) {
    bySlug.set(slug, coworker.name);
  }

  return { byKey, bySlug };
}

/** Shared mention-picker payload for humans, coworkers, and synthetic @all. */
export interface RoomMentionParticipant {
  kind: "human" | "coworker" | "all";
  id: string;
  name: string;
  slug: string;
  image: string | null;
}

/**
 * Synthetic catalog row for the @all picker entry.
 * `label` is the localized display/search value (e.g. "Everyone"); key/slug stay `all`.
 */
export function buildRoomAllMentionRecord(label: string): {
  value: string;
  slug: string;
  data: RoomMentionParticipant;
} {
  return {
    value: label,
    slug: ROOM_MENTION_ALL_SLUG,
    data: {
      kind: "all",
      id: ROOM_MENTION_ALL_ID,
      name: label,
      slug: ROOM_MENTION_ALL_SLUG,
      image: null,
    },
  };
}

/**
 * Partition filtered room mention suggestions into People (humans + @all)
 * and Coworkers. Omits empty sections. Preserves within-section filter order.
 */
export function omitCoworkerMentionRecords<
  T extends { data?: { kind?: string } },
>(records: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(records).filter(
      ([, entry]) => entry.data?.kind !== "coworker",
    ),
  );
}

export function partitionRoomMentionSuggestions(
  filtered: NormalizedMention<RoomMentionParticipant>[],
  labels: { peopleLabel: string; coworkersLabel: string },
): MentionSuggestionGroup<RoomMentionParticipant>[] {
  const people: NormalizedMention<RoomMentionParticipant>[] = [];
  const coworkers: NormalizedMention<RoomMentionParticipant>[] = [];

  for (const mention of filtered) {
    if (mention.data?.kind === "coworker") {
      coworkers.push(mention);
    } else {
      // human | all | missing kind → People (safe fallback for humans-shaped rows)
      people.push(mention);
    }
  }

  const groups: MentionSuggestionGroup<RoomMentionParticipant>[] = [];
  if (people.length > 0) {
    groups.push({
      id: "people",
      label: labels.peopleLabel,
      items: people,
    });
  }
  if (coworkers.length > 0) {
    groups.push({
      id: "coworkers",
      label: labels.coworkersLabel,
      items: coworkers,
    });
  }
  return groups;
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
  attachment: ChatRoomQuoteAttachment | null;
}

export function pendingQuoteFromMessage(
  message: ChatRoomMessage,
): PendingRoomQuote {
  const { snippet, attachment } = buildRoomQuoteSnippetParts(message.content);
  return {
    messageId: message.id,
    authorName: messageSender(message).name,
    snippet,
    attachment,
  };
}

/** Soft-fail scroll to a room message article when it is still in the DOM. */
export function scrollToRoomMessageElement(
  messageId: string,
  options?: { behavior?: ScrollBehavior },
): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const target = document.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  );
  if (!target) {
    return false;
  }
  target.scrollIntoView({
    behavior: options?.behavior ?? "smooth",
    block: "center",
  });
  return true;
}

const ROOM_MESSAGE_HIGHLIGHT_MS = 2500;
const ROOM_MESSAGE_HIGHLIGHT_CLASSES = [
  "ring-2",
  "ring-primary",
  "bg-primary/20",
] as const;

/** Scroll into view and apply a short-lived highlight when the node exists. */
export function highlightRoomMessageElement(messageId: string): boolean {
  if (!scrollToRoomMessageElement(messageId, { behavior: "auto" })) {
    return false;
  }
  const target = document.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  );
  if (!target) {
    return false;
  }
  target.dataset.searchLanded = "true";
  target.classList.add(...ROOM_MESSAGE_HIGHLIGHT_CLASSES);
  window.setTimeout(() => {
    delete target.dataset.searchLanded;
    target.classList.remove(...ROOM_MESSAGE_HIGHLIGHT_CLASSES);
  }, ROOM_MESSAGE_HIGHLIGHT_MS);
  return true;
}

export function messageSender(message: ChatRoomMessage): MessageSenderProfile {
  if (message.sender.type === "user") {
    const user = message.sender.user;
    return {
      kind: "human",
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      presence: user.presence,
    };
  }
  if (message.sender.type === "coworker") {
    const coworker = message.sender.coworker;
    return {
      kind: "coworker",
      id: coworker.id,
      name: coworker.name,
      slug: coworker.slug,
      caption: coworker.caption,
      image: coworker.image,
      presence: coworker.presence,
    };
  }
  return {
    kind: "unknown",
    name: "Unknown",
    image: null,
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
 * (omit avatar / name / wall-clock; group header time covers the burst).
 */
export function isMessageContinuation(
  previous: ChatRoomMessage | undefined,
  current: ChatRoomMessage,
  options?: { gapMs?: number },
): boolean {
  if (!previous) {
    return false;
  }

  // Membership status rows are not chat bubbles; never continue across them.
  if (previous.membership != null || current.membership != null) {
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

/**
 * Wall-clock HH:mm in the runtime default locale/TZ. Only call after
 * `useClientLocalCalendarReady()` (see MessageWallClockTime) — `undefined`
 * locale + local TZ diverge between Vercel SSR and the browser (SOKOSUMI-A).
 */
export function formatMessageTime(value: Date | string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/**
 * Local calendar day bucket. Runtime-TZ sensitive — gate separator insertion
 * with `useClientLocalCalendarReady()` so SSR (UTC) and hydrate agree.
 */
export function messageDayKey(value: Date | string): string {
  return new Date(value).toDateString();
}

export function getDirectRoomTarget(room: ChatRoom, currentUserId: string) {
  return (
    room.userMembers.find((member) => member.id !== currentUserId) ??
    room.userMembers[0] ??
    null
  );
}

function compareByDisplayNameThenId(
  a: { name: string; id: string },
  b: { name: string; id: string },
): number {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) {
    return byName;
  }
  return a.id.localeCompare(b.id);
}

export function getDirectRoomParticipants(
  room: ChatRoom,
  currentUserId: string,
): DirectParticipantPreview[] {
  const humans = room.userMembers
    .filter((member) => member.id !== currentUserId)
    .map((member) => ({
      id: member.id,
      name: member.name || member.email,
      detail: member.email,
      image: member.image,
      presence: member.presence,
      kind: "human" as const,
    }))
    .toSorted(compareByDisplayNameThenId);

  const coworkers = room.coworkerMembers
    .map((coworker) => ({
      id: coworker.id,
      name: coworker.name,
      detail: coworker.caption,
      image: coworker.image,
      presence: coworker.presence,
      kind: "coworker" as const,
    }))
    .toSorted(compareByDisplayNameThenId);

  return [...humans, ...coworkers];
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
  isThinkingShell?: boolean;
}): boolean {
  if (options.isStreamOverlay || options.isThinkingShell) return false;
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
  const humans = room.userMembers
    .map(
      (member): ChatParticipantHoverProfile => ({
        kind: "human",
        id: member.id,
        name: member.name || member.email,
        email: member.email,
        image: member.image,
        presence: member.presence,
      }),
    )
    .toSorted(compareByDisplayNameThenId);

  const coworkers = room.coworkerMembers
    .map(
      (coworker): ChatParticipantHoverProfile => ({
        kind: "coworker",
        id: coworker.id,
        name: coworker.name,
        slug: coworker.slug,
        caption: coworker.caption,
        image: coworker.image,
        presence: coworker.presence,
      }),
    )
    .toSorted(compareByDisplayNameThenId);

  return [...humans, ...coworkers];
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

export interface MentionDirectTarget {
  kind: "human" | "coworker";
  id: string;
}

const MENTION_CHIP_CLASSNAME = "text-primary font-medium whitespace-nowrap";

export type MentionHoverUserLookup = Pick<
  ChatRoomUserParticipant,
  "id" | "name"
> &
  Partial<Pick<ChatRoomUserParticipant, "email" | "image" | "presence">>;

export function mentionDirectTargetFromAttributes(
  attributes: Record<string, unknown>,
): MentionDirectTarget | null {
  const kindRaw =
    attributes["data-direct-kind"] ??
    attributes.dataDirectKind ??
    attributes["data-directKind"];
  const idRaw =
    attributes["data-direct-id"] ??
    attributes.dataDirectId ??
    attributes["data-directId"];
  const kind = typeof kindRaw === "string" ? kindRaw : null;
  const id = typeof idRaw === "string" ? idRaw : null;
  if ((kind !== "human" && kind !== "coworker") || !id) {
    return null;
  }
  return { kind, id };
}

export function parseMentionDirectChip(
  node: Element,
): MentionDirectTarget | null {
  const host = node.closest("[data-direct-kind]");
  if (!(host instanceof HTMLElement)) {
    return null;
  }
  return mentionDirectTargetFromAttributes({
    "data-direct-kind": host.dataset.directKind,
    "data-direct-id": host.dataset.directId,
  });
}

function humanPresence(value: unknown): ChatRoomPresence {
  if (value === "online" || value === "afk" || value === "offline") {
    return value;
  }
  return "offline";
}

export function chatParticipantProfileForDirectTarget(
  target: MentionDirectTarget,
  lookups: {
    coworkersById: Map<string, ChatRoomCoworkerParticipant>;
    usersById?: Map<string, MentionHoverUserLookup>;
  },
): ChatParticipantHoverProfile | null {
  if (target.kind === "coworker") {
    const coworker = lookups.coworkersById.get(target.id);
    if (!coworker) {
      return null;
    }
    return {
      kind: "coworker",
      id: coworker.id,
      name: coworker.name,
      slug: coworker.slug,
      caption: coworker.caption,
      image: coworker.image,
      presence: coworker.presence,
    };
  }
  const user = lookups.usersById?.get(target.id);
  if (!user) {
    return null;
  }
  return {
    kind: "human",
    id: user.id,
    name: user.name,
    email: user.email ?? "",
    image: user.image ?? null,
    presence: humanPresence(user.presence),
  };
}

export function resolveMentionDirectTarget({
  mentionId,
  mentionSlug,
  coworkersById,
  coworkersBySlug,
  usersById,
  usersBySlug,
}: {
  mentionId: string;
  mentionSlug: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  usersById?: Map<string, MentionHoverUserLookup>;
  usersBySlug?: Map<string, MentionHoverUserLookup>;
}): MentionDirectTarget | null {
  if (isRoomMentionAllId(mentionId)) {
    return null;
  }
  const coworker =
    coworkersById.get(mentionId) ?? coworkersBySlug.get(mentionSlug);
  if (coworker) {
    return { kind: "coworker", id: coworker.id };
  }
  const user = usersById?.get(mentionId) ?? usersBySlug?.get(mentionSlug);
  if (!user) {
    return null;
  }
  return { kind: "human", id: user.id };
}

function mentionChipHtml(
  displayName: string,
  target: MentionDirectTarget | null,
): string {
  const label = escapeHtml(`@${displayName}`);
  if (target) {
    return `<span class="${MENTION_CHIP_CLASSNAME}" data-direct-kind="${escapeHtml(target.kind)}" data-direct-id="${escapeHtml(target.id)}">${label}</span>`;
  }
  return `<span class="${MENTION_CHIP_CLASSNAME}">${label}</span>`;
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
  usersById?: Map<string, MentionHoverUserLookup>;
  usersBySlug?: Map<string, MentionHoverUserLookup>;
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
    const coworker =
      coworkersById.get(match.id) ?? coworkersBySlug.get(match.slug);
    const user = usersById?.get(match.id) ?? usersBySlug?.get(match.slug);
    const displayName = isRoomMentionAllId(match.id)
      ? ROOM_MENTION_ALL_ID
      : (coworker?.name ?? user?.name);
    if (displayName) {
      formatted += mentionChipHtml(
        displayName,
        resolveMentionDirectTarget({
          mentionId: match.id,
          mentionSlug: match.slug,
          coworkersById,
          coworkersBySlug,
          usersById,
          usersBySlug,
        }),
      );
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

export function mergeMembershipVisibleRooms<T extends Pick<ChatRoom, "id">>(
  pageRooms: readonly T[],
  sidebarRooms: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const room of sidebarRooms) {
    byId.set(room.id, room);
  }
  for (const room of pageRooms) {
    if (!byId.has(room.id)) {
      byId.set(room.id, room);
    }
  }
  return [...byId.values()];
}

function channelPickerOrganizationName(
  room: Pick<ChatRoom, "discoverability" | "myAccess" | "organizationName">,
): string | null {
  if (room.discoverability === "external" || room.myAccess === "guest") {
    return room.organizationName ?? null;
  }
  return null;
}

export function membershipVisibleChannelOptions(
  rooms: readonly Pick<
    ChatRoom,
    | "id"
    | "name"
    | "slug"
    | "kind"
    | "organizationName"
    | "discoverability"
    | "myAccess"
  >[],
): ComposerChannelOption[] {
  const options: ComposerChannelOption[] = [];
  for (const room of rooms) {
    if (room.kind !== "channel" || !room.slug) continue;
    options.push({
      id: room.id,
      name: room.name,
      slug: room.slug,
      organizationName: channelPickerOrganizationName(room),
    });
  }
  return options;
}

export function membershipVisibleChannelLinks(
  rooms: readonly Pick<ChatRoom, "id" | "name" | "slug" | "kind">[],
): ChannelLinkTarget[] {
  const links: ChannelLinkTarget[] = [];
  for (const room of rooms) {
    if (room.kind !== "channel" || !room.slug) continue;
    links.push({
      name: room.name,
      slug: room.slug,
      href: chatRoomHref(room.id),
    });
  }
  return links;
}

export function formatRoomMarkdownContent({
  content,
  coworkersById,
  coworkersBySlug,
  usersById,
  usersBySlug,
  channelLinks = [],
}: {
  content: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  usersById?: Map<string, MentionHoverUserLookup>;
  usersBySlug?: Map<string, MentionHoverUserLookup>;
  channelLinks?: readonly ChannelLinkTarget[];
}): string {
  return linkifyChannelLinksInMarkdown(
    formatRoomMarkdownMentions({
      content,
      coworkersById,
      coworkersBySlug,
      usersById,
      usersBySlug,
    }),
    channelLinks,
  );
}
