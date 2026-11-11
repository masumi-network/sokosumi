/**
 * Turns raw provider payloads (Composio's Gmail, Outlook, Google Calendar,
 * Slack and X responses) into capture candidates: a person, their channels, and
 * one interaction with the teammate who had it. Pure, so every extractor is
 * tested on recorded fixtures.
 */
import { parseSignature } from "@sokosumi/utils";
import { stripTags } from "@/lib/open-graph-html";
import {
  type CaptureIdentity,
  type CaptureSkipReason,
  classifyAddress,
  hasBulkCategory,
  isAutoReplySubject,
  isBulkMail,
  isCalendarNoticeSubject,
  LARGE_MEETING_ATTENDEES,
  MASS_MAIL_RECIPIENTS,
} from "./capture-filters";

export interface CaptureChannel {
  type: "EMAIL" | "PHONE" | "LINKEDIN" | "SLACK" | "X";
  value: string;
  verified?: boolean;
}

export interface CaptureCandidate {
  name?: string;
  organization?: string;
  role?: string;
  channels: CaptureChannel[];
  interaction: {
    occurredAt: string;
    channel: "EMAIL" | "MEETING" | "SLACK" | "X";
    direction: "IN" | "OUT" | "BOTH";
    summary: string;
    sourceRef: string;
    sourceUrl?: string;
  };
  /** A role inbox: only captured when the judge sees a person behind it. */
  borderline: boolean;
}

export interface Extraction {
  candidates: CaptureCandidate[];
  skipped: CaptureSkipReason[];
}

export interface ExtractContext {
  provider: string;
  teammateUserId: string;
  identity: CaptureIdentity;
}

const EMPTY: Extraction = { candidates: [], skipped: [] };

// ---------------------------------------------------------------------------
// Small readers for loosely typed provider JSON.
// ---------------------------------------------------------------------------

function field(value: unknown, ...keys: string[]): unknown {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    const found = (value as Record<string, unknown>)[key];
    if (found !== undefined && found !== null) return found;
  }
  return undefined;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isoDate(value: unknown): string | null {
  if (typeof value === "number") {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const raw = text(value).trim();
  if (!raw) return null;
  const date = new Date(/^\d+$/.test(raw) ? Number(raw) : raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ---------------------------------------------------------------------------
// Addresses and names.
// ---------------------------------------------------------------------------

export interface MailAddress {
  email: string;
  name: string | null;
}

/** Splits `a, "Doe, Jane" <j@x.com>` on the commas that separate addresses. */
function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let angled = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    else if (char === "<") angled = true;
    else if (char === ">") angled = false;
    if ((char === "," || char === ";") && !quoted && !angled) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** "Doe, Jane" → "Jane Doe"; quotes, `(via X)` and stray addresses removed. */
export function cleanPersonName(
  raw: string | null | undefined,
  email?: string,
): string | undefined {
  if (!raw) return undefined;
  let name = raw
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s*\((via|über|par)\s[^)]*\)\s*$/i, "")
    .replace(/\s*<[^>]*>\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const comma = /^([^,]+),\s*([^,]+)$/.exec(name);
  if (comma?.[1] && comma[2] && !/\b(inc|ltd|llc|gmbh|ag)\b/i.test(name))
    name = `${comma[2]} ${comma[1]}`;
  if (!name || name.includes("@")) return undefined;
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && name.toLowerCase() === local) return undefined;
  return name.slice(0, 200);
}

function parseAddress(raw: string): MailAddress | null {
  const angle = /^(.*)<([^<>]+)>\s*$/.exec(raw);
  const email = (angle?.[2] ?? raw).trim().replace(/^mailto:/i, "");
  if (!email.includes("@")) return null;
  const lower = email.toLowerCase();
  return { email: lower, name: cleanPersonName(angle?.[1], lower) ?? null };
}

/** Addresses from a header string or a provider's recipient objects. */
export function parseAddresses(value: unknown): MailAddress[] {
  if (typeof value === "string")
    return splitAddressList(value).flatMap((part) => parseAddress(part) ?? []);
  return list(value).flatMap((entry) => {
    if (typeof entry === "string") return parseAddresses(entry);
    const inner = field(entry, "emailAddress") ?? entry;
    const email = text(field(inner, "address", "email"))
      .trim()
      .toLowerCase();
    if (!email.includes("@")) return [];
    const name = text(field(inner, "name", "displayName"));
    return [{ email, name: cleanPersonName(name, email) ?? null }];
  });
}

// ---------------------------------------------------------------------------
// Mail.
// ---------------------------------------------------------------------------

export interface ParsedMail {
  id: string;
  threadId: string | null;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  occurredAt: string;
  labels: string[];
  /** Lowercased header name → value. */
  headers: Map<string, string>;
  body: string;
  webUrl: string | null;
}

function headerMap(raw: unknown): Map<string, string> {
  const headers = new Map<string, string>();
  const entries = list(
    field(field(raw, "payload"), "headers") ??
      field(raw, "internetMessageHeaders", "headers"),
  );
  for (const entry of entries) {
    const name = text(field(entry, "name")).toLowerCase();
    if (name && !headers.has(name))
      headers.set(name, text(field(entry, "value")));
  }
  return headers;
}

function stripHtml(html: string): string {
  let text = html.replace(/<(br|\/p|\/div|\/tr|\/li)[^>]*>/gi, "\n");
  let previous: string;
  // Until stable, so a removal cannot join "<scr<style></style>ipt>" into a new block.
  do {
    previous = text;
    text = text.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  } while (text !== previous);
  // stripTags never emits "<", so no tag survives; an unclosed "<" drops the rest.
  return (
    stripTags(text)
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      // Last, so "&amp;lt;" stays the literal text "&lt;".
      .replace(/&amp;/g, "&")
  );
}

/** One Gmail or Outlook message, from a Composio list or get response. */
export function parseMail(raw: unknown): ParsedMail | null {
  const id = text(field(raw, "messageId", "id"));
  if (!id) return null;
  const headers = headerMap(raw);
  const fromValue = field(raw, "from", "sender") ?? headers.get("from");
  const from =
    (typeof fromValue === "object" && !Array.isArray(fromValue)
      ? parseAddresses([fromValue])
      : parseAddresses(fromValue))[0] ?? null;
  const occurredAt =
    isoDate(
      field(
        raw,
        "messageTimestamp",
        "sentDateTime",
        "receivedDateTime",
        "internalDate",
        "date",
      ),
    ) ?? isoDate(headers.get("date"));
  if (!occurredAt) return null;
  const outlookBody = field(raw, "body");
  const bodyContent = text(field(outlookBody, "content"));
  const body =
    text(field(raw, "messageText", "text")) ||
    (text(field(outlookBody, "contentType")).toLowerCase() === "html"
      ? stripHtml(bodyContent)
      : bodyContent) ||
    text(field(raw, "bodyPreview", "snippet"));
  return {
    id,
    threadId: text(field(raw, "threadId", "conversationId")) || null,
    from,
    to: parseAddresses(
      field(raw, "toRecipients", "to") ?? headers.get("to") ?? "",
    ),
    cc: parseAddresses(
      field(raw, "ccRecipients", "cc") ?? headers.get("cc") ?? "",
    ),
    subject: text(field(raw, "subject")) || headers.get("subject") || "",
    occurredAt,
    labels: list(field(raw, "labelIds", "labels")).map(text),
    headers,
    body: body.slice(0, 20_000),
    webUrl: text(field(raw, "webLink")) || null,
  };
}

/** "Re: Fwd: Pilot pricing" → "Pilot pricing". */
export function mailTopic(subject: string): string {
  const topic = subject
    .replace(/^\s*((re|fw|fwd|aw|wg|sv|antw|tr)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return (topic || "Email without a subject").slice(0, 300);
}

function mailRef(
  context: ExtractContext,
  mailId: string,
  email: string,
): string {
  return `${context.provider}:${context.teammateUserId}:${mailId}:${email}`;
}

/**
 * Everyone a message the owner sent went to (To and Cc): the people the
 * owner writes to or answered. Mass mailings, auto-replies and calendar
 * RSVPs are not conversations.
 */
export function extractSentMail(
  mail: ParsedMail,
  context: ExtractContext,
): Extraction {
  if (isAutoReplySubject(mail.subject))
    return { candidates: [], skipped: ["auto_reply"] };
  if (isCalendarNoticeSubject(mail.subject))
    return { candidates: [], skipped: ["calendar_notice"] };
  const recipients = [
    ...new Map(
      [...mail.to, ...mail.cc].map((address) => [address.email, address]),
    ).values(),
  ];
  if (recipients.length > MASS_MAIL_RECIPIENTS)
    return { candidates: [], skipped: ["mass_mail"] };
  const result: Extraction = { candidates: [], skipped: [] };
  for (const recipient of recipients) {
    const verdict = classifyAddress(recipient.email, context.identity, {
      ownerInitiated: true,
    });
    if (!verdict.ok) {
      result.skipped.push(verdict.reason);
      continue;
    }
    result.candidates.push({
      name: recipient.name ?? undefined,
      channels: [{ type: "EMAIL", value: recipient.email }],
      interaction: {
        occurredAt: mail.occurredAt,
        channel: "EMAIL",
        direction: "OUT",
        summary: mailTopic(mail.subject),
        sourceRef: mailRef(context, mail.id, recipient.email),
        ...(mail.webUrl ? { sourceUrl: mail.webUrl } : {}),
      },
      borderline: verdict.borderline,
    });
  }
  return result;
}

/**
 * The sender of a message the owner received. Whether the owner ever wrote
 * to them is checked by the caller against the contacts: one-way inbound
 * mail is never captured.
 */
export function extractInboundMail(
  mail: ParsedMail,
  context: ExtractContext,
): Extraction {
  if (!mail.from) return { candidates: [], skipped: ["invalid_address"] };
  if (hasBulkCategory(mail.labels))
    return { candidates: [], skipped: ["bulk_category"] };
  if (isBulkMail(mail.headers))
    return { candidates: [], skipped: ["bulk_header"] };
  if (isAutoReplySubject(mail.subject))
    return { candidates: [], skipped: ["auto_reply"] };
  if (isCalendarNoticeSubject(mail.subject))
    return { candidates: [], skipped: ["calendar_notice"] };
  const verdict = classifyAddress(mail.from.email, context.identity, {
    ownerInitiated: false,
  });
  if (!verdict.ok) return { candidates: [], skipped: [verdict.reason] };
  const signature = parseSignature(mail.body, mail.from.name);
  const channels: CaptureChannel[] = [
    { type: "EMAIL", value: mail.from.email },
  ];
  if (signature.phone) channels.push({ type: "PHONE", value: signature.phone });
  if (signature.linkedIn)
    channels.push({ type: "LINKEDIN", value: signature.linkedIn });
  return {
    candidates: [
      {
        name: mail.from.name ?? undefined,
        organization: signature.organization,
        role: signature.role,
        channels,
        interaction: {
          occurredAt: mail.occurredAt,
          channel: "EMAIL",
          direction: "IN",
          summary: mailTopic(mail.subject),
          sourceRef: mailRef(context, mail.id, mail.from.email),
          ...(mail.webUrl ? { sourceUrl: mail.webUrl } : {}),
        },
        borderline: verdict.borderline,
      },
    ],
    skipped: [],
  };
}

// ---------------------------------------------------------------------------
// Calendar.
// ---------------------------------------------------------------------------

export interface ParsedAttendee {
  email: string;
  name: string | null;
  self: boolean;
  organizer: boolean;
  resource: boolean;
  declined: boolean;
}

export interface ParsedEvent {
  id: string;
  title: string;
  startsAt: string;
  allDay: boolean;
  cancelled: boolean;
  /** Focus time, out of office, working location: not meetings. */
  personal: boolean;
  ownerDeclined: boolean;
  organizerEmail: string | null;
  attendees: ParsedAttendee[];
  link: string | null;
}

const RESOURCE_DOMAIN =
  /(^|\.)(resource\.calendar\.google\.com|group\.calendar\.google\.com|group\.v\.calendar\.google\.com|import\.calendar\.google\.com)$/;

function eventTime(value: unknown): { iso: string | null; allDay: boolean } {
  const date = text(field(value, "date"));
  if (date) return { iso: isoDate(`${date}T00:00:00Z`), allDay: true };
  let dateTime = text(field(value, "dateTime")) || text(value);
  const zone = text(field(value, "timeZone"));
  // Graph answers in the zone it was asked for, without an offset.
  if (dateTime && !/[zZ]|[+-]\d\d:?\d\d$/.test(dateTime) && /^utc$/i.test(zone))
    dateTime = `${dateTime}Z`;
  return { iso: isoDate(dateTime), allDay: false };
}

/** One Google Calendar or Outlook event. */
export function parseEvent(raw: unknown): ParsedEvent | null {
  const id = text(field(raw, "id"));
  const start = eventTime(field(raw, "start"));
  if (!id || !start.iso) return null;
  const organizerEmail =
    parseAddresses([field(raw, "organizer") ?? ""])[0]?.email ?? null;
  const attendees = list(field(raw, "attendees")).flatMap(
    (entry): ParsedAttendee[] => {
      const [address] = parseAddresses([entry]);
      if (!address) return [];
      const response = text(
        field(entry, "responseStatus") ??
          field(field(entry, "status"), "response"),
      ).toLowerCase();
      return [
        {
          email: address.email,
          name: address.name,
          self: field(entry, "self") === true,
          organizer:
            field(entry, "organizer") === true ||
            address.email === organizerEmail,
          resource:
            field(entry, "resource") === true ||
            text(field(entry, "type")).toLowerCase() === "resource" ||
            RESOURCE_DOMAIN.test(address.email.split("@")[1] ?? ""),
          declined: response === "declined",
        },
      ];
    },
  );
  const eventType = text(field(raw, "eventType"));
  const showAs = text(field(raw, "showAs")).toLowerCase();
  const ownResponse = text(
    field(field(raw, "responseStatus"), "response"),
  ).toLowerCase();
  return {
    id,
    title: text(field(raw, "summary", "subject", "title")).trim() || "Meeting",
    startsAt: start.iso,
    allDay: start.allDay || field(raw, "isAllDay") === true,
    cancelled:
      text(field(raw, "status")).toLowerCase() === "cancelled" ||
      field(raw, "isCancelled") === true,
    personal: (eventType !== "" && eventType !== "default") || showAs === "oof",
    ownerDeclined:
      attendees.some((attendee) => attendee.self && attendee.declined) ||
      ownResponse === "declined",
    organizerEmail,
    attendees,
    link: text(field(raw, "htmlLink", "webLink")) || null,
  };
}

/**
 * The people at a real meeting that already started: not cancelled, not an
 * all-day block or focus time, not declined by the owner, and small enough
 * to be a conversation. Rooms, the owner, teammates and attendees who
 * declined are left out.
 */
export function extractMeeting(
  event: ParsedEvent,
  context: ExtractContext,
  now: Date,
): Extraction {
  if (event.cancelled || event.allDay || event.personal)
    return { candidates: [], skipped: ["not_a_meeting"] };
  if (new Date(event.startsAt).getTime() > now.getTime()) return EMPTY;
  if (event.ownerDeclined) return { candidates: [], skipped: ["declined"] };
  const people = event.attendees.filter((attendee) => !attendee.resource);
  if (people.length > LARGE_MEETING_ATTENDEES)
    return { candidates: [], skipped: ["large_meeting"] };
  const ownerOrganized =
    event.organizerEmail !== null &&
    context.identity.ownerEmails.has(event.organizerEmail);
  const result: Extraction = { candidates: [], skipped: [] };
  for (const attendee of event.attendees) {
    if (attendee.resource) {
      result.skipped.push("room_or_resource");
      continue;
    }
    if (attendee.self) {
      result.skipped.push("self");
      continue;
    }
    if (attendee.declined) {
      result.skipped.push("declined");
      continue;
    }
    const verdict = classifyAddress(attendee.email, context.identity, {
      ownerInitiated: ownerOrganized,
    });
    if (!verdict.ok) {
      result.skipped.push(verdict.reason);
      continue;
    }
    result.candidates.push({
      name: attendee.name ?? undefined,
      channels: [{ type: "EMAIL", value: attendee.email }],
      interaction: {
        occurredAt: event.startsAt,
        channel: "MEETING",
        direction: "BOTH",
        summary: event.title.slice(0, 300),
        sourceRef: `${context.provider}:${context.teammateUserId}:${event.id}:${attendee.email}`,
        ...(event.link ? { sourceUrl: event.link } : {}),
      },
      borderline: verdict.borderline,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Slack.
// ---------------------------------------------------------------------------

export interface SlackProfile {
  id: string;
  teamId: string;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  isBot: boolean;
  deleted: boolean;
}

/** `users.info`'s user, as Composio returns it. */
export function parseSlackProfile(raw: unknown): SlackProfile | null {
  const user = field(raw, "user") ?? raw;
  const id = text(field(user, "id"));
  if (!id) return null;
  const profile = field(user, "profile");
  const name =
    text(field(profile, "real_name")) ||
    text(field(user, "real_name")) ||
    text(field(profile, "display_name"));
  return {
    id,
    teamId: text(field(user, "team_id")) || text(field(profile, "team")),
    name: cleanPersonName(name) ?? null,
    title: text(field(profile, "title")).trim() || null,
    email: text(field(profile, "email")).trim().toLowerCase() || null,
    phone: text(field(profile, "phone")).trim() || null,
    isBot:
      field(user, "is_bot") === true ||
      field(user, "is_app_user") === true ||
      id === "USLACKBOT",
    deleted: field(user, "deleted") === true,
  };
}

export interface SlackConversation {
  id: string;
  /** The other person of a direct message. */
  dmUserId: string | null;
  name: string | null;
  isDirect: boolean;
}

export function parseSlackConversation(raw: unknown): SlackConversation | null {
  const id = text(field(raw, "id"));
  if (!id) return null;
  const isIm = field(raw, "is_im") === true;
  return {
    id,
    dmUserId: isIm ? text(field(raw, "user")) || null : null,
    name: text(field(raw, "name")) || null,
    isDirect: isIm || field(raw, "is_mpim") === true,
  };
}

/** Per UTC day: who posted in a conversation; bots and joins ignored. */
export function slackDays(
  messages: readonly unknown[],
): Map<string, Set<string>> {
  const days = new Map<string, Set<string>>();
  for (const message of messages) {
    const user = text(field(message, "user"));
    const subtype = text(field(message, "subtype"));
    if (
      !user ||
      field(message, "bot_id") ||
      (subtype && subtype !== "thread_broadcast")
    )
      continue;
    const ts = Number(text(field(message, "ts")));
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const day = new Date(ts * 1000).toISOString().slice(0, 10);
    const posters = days.get(day) ?? new Set<string>();
    posters.add(user);
    days.set(day, posters);
  }
  return days;
}

/**
 * One interaction per person per day the owner talked with them: in a direct
 * message every day the owner wrote, in a small channel every day both wrote.
 */
export function extractSlackConversation(input: {
  conversation: SlackConversation;
  days: Map<string, Set<string>>;
  ownerSlackId: string;
  teamId: string;
  teammateUserId: string;
}): { day: string; userId: string; direction: "OUT" | "BOTH" }[] {
  const result: { day: string; userId: string; direction: "OUT" | "BOTH" }[] =
    [];
  for (const [day, posters] of input.days) {
    if (!posters.has(input.ownerSlackId)) continue;
    const others = input.conversation.dmUserId
      ? [input.conversation.dmUserId]
      : [...posters].filter((user) => user !== input.ownerSlackId);
    for (const userId of others) {
      if (userId === input.ownerSlackId) continue;
      result.push({
        day,
        userId,
        direction: posters.has(userId) ? "BOTH" : "OUT",
      });
    }
  }
  return result;
}

export function slackCandidate(input: {
  profile: SlackProfile;
  conversation: SlackConversation;
  day: string;
  direction: "OUT" | "BOTH";
  teammateUserId: string;
  teamId: string;
}): CaptureCandidate {
  const { profile } = input;
  const channels: CaptureChannel[] = [
    {
      type: "SLACK",
      value: `${profile.teamId || input.teamId}:${profile.id}`,
      verified: true,
    },
  ];
  if (profile.email)
    channels.push({ type: "EMAIL", value: profile.email, verified: true });
  if (profile.phone) channels.push({ type: "PHONE", value: profile.phone });
  return {
    name: profile.name ?? undefined,
    role: profile.title ?? undefined,
    channels,
    interaction: {
      occurredAt: `${input.day}T12:00:00.000Z`,
      channel: "SLACK",
      direction: input.direction,
      summary: input.conversation.isDirect
        ? "Slack direct message"
        : `Slack in #${input.conversation.name ?? "channel"}`,
      sourceRef: `slack:${input.teammateUserId}:${input.conversation.id}:${input.day}:${profile.id}`,
    },
    borderline: false,
  };
}

// ---------------------------------------------------------------------------
// X: direct messages and followers.
// ---------------------------------------------------------------------------

export interface XUser {
  id: string;
  name: string | null;
  username: string;
}

export interface XDmEvent {
  conversationId: string;
  senderId: string;
  participantIds: string[];
  createdAt: string;
}

/** A group DM with more people than this is not a conversation. */
export const X_SMALL_GROUP = 8;

/**
 * One page of an X API v2 response as Composio returns it: the list in
 * `data` (sometimes wrapped in another `data`), expanded users in
 * `includes.users`, and `meta.next_token`.
 */
export function parseXPage(raw: unknown): {
  items: unknown[];
  users: XUser[];
  nextToken: string | null;
} {
  const inner = field(raw, "data");
  const body =
    inner && !Array.isArray(inner) && typeof inner === "object" ? inner : raw;
  return {
    items: list(field(body, "data")),
    users: list(field(field(body, "includes"), "users")).flatMap(
      (user) => parseXUser(user) ?? [],
    ),
    nextToken: text(field(field(body, "meta"), "next_token")) || null,
  };
}

export function parseXUser(raw: unknown): XUser | null {
  const user = field(raw, "data") ?? raw;
  const id = text(field(user, "id"));
  const username = text(field(user, "username"));
  if (!id || !username) return null;
  return { id, username, name: text(field(user, "name")) || null };
}

/** A sent message; joins, leaves and other events are not conversation. */
export function parseXDmEvent(raw: unknown): XDmEvent | null {
  if (text(field(raw, "event_type")) !== "MessageCreate") return null;
  const conversationId = text(field(raw, "dm_conversation_id"));
  const senderId = text(field(raw, "sender_id"));
  const createdAt = isoDate(field(raw, "created_at"));
  if (!conversationId || !senderId || !createdAt) return null;
  return {
    conversationId,
    senderId,
    participantIds: list(field(raw, "participant_ids")).map(text),
    createdAt,
  };
}

/**
 * One interaction per person per day the owner wrote in a conversation, like
 * Slack. A one-to-one conversation id is the two user ids joined by a dash.
 */
export function extractXDms(input: {
  events: readonly XDmEvent[];
  ownerId: string;
}): {
  day: string;
  conversationId: string;
  userId: string;
  group: boolean;
  direction: "OUT" | "BOTH";
}[] {
  const conversations = new Map<
    string,
    { members: Set<string>; days: Map<string, Set<string>> }
  >();
  for (const event of input.events) {
    const conversation = conversations.get(event.conversationId) ?? {
      members: new Set<string>(),
      days: new Map<string, Set<string>>(),
    };
    for (const id of event.participantIds) conversation.members.add(id);
    const pair = event.conversationId.split("-");
    if (pair.length === 2) for (const id of pair) conversation.members.add(id);
    conversation.members.add(event.senderId);
    const day = event.createdAt.slice(0, 10);
    const posters = conversation.days.get(day) ?? new Set<string>();
    posters.add(event.senderId);
    conversation.days.set(day, posters);
    conversations.set(event.conversationId, conversation);
  }
  const result: ReturnType<typeof extractXDms> = [];
  for (const [conversationId, conversation] of conversations) {
    const others = [...conversation.members].filter(
      (id) => id !== input.ownerId,
    );
    if (others.length === 0 || others.length > X_SMALL_GROUP) continue;
    for (const [day, posters] of conversation.days) {
      if (!posters.has(input.ownerId)) continue;
      for (const userId of others)
        result.push({
          day,
          conversationId,
          userId,
          group: others.length > 1,
          direction: posters.has(userId) ? "BOTH" : "OUT",
        });
    }
  }
  return result;
}

export function xCandidate(input: {
  user: XUser;
  conversationId: string;
  day: string;
  group: boolean;
  direction: "OUT" | "BOTH";
  teammateUserId: string;
}): CaptureCandidate {
  const { user } = input;
  return {
    name: user.name ?? undefined,
    channels: [{ type: "X", value: user.username, verified: true }],
    interaction: {
      occurredAt: `${input.day}T12:00:00.000Z`,
      channel: "X",
      direction: input.direction,
      summary: input.group ? "X group message" : "X direct message",
      sourceRef: `x:${input.teammateUserId}:${input.conversationId}:${input.day}:${user.id}`,
    },
    borderline: false,
  };
}
