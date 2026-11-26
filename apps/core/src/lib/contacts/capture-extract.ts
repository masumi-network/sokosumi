/**
 * Turns raw provider payloads (Composio's Gmail, Outlook, Google Calendar,
 * Slack and X responses) into capture candidates: a person, their channels, and
 * one interaction with the teammate who had it. Pure, so every extractor is
 * tested on recorded fixtures.
 */
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

import {
  cleanPersonName,
  field,
  isoDate,
  list,
  type MailAddress,
  type ParsedEvent,
  parseAddresses,
  text,
} from "./capture-provider";

// These parser exports are part of the contact capture interface.
export {
  cleanPersonName,
  type MailAddress,
  type ParsedAttendee,
  type ParsedEvent,
  parseAddresses,
  parseEvent,
} from "./capture-provider";

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
// Signatures.
// ---------------------------------------------------------------------------

export interface Signature {
  role?: string;
  organization?: string;
  phone?: string;
  linkedIn?: string;
}

const QUOTE_START =
  /^(>|on .+wrote:?$|am .+schrieb.*:?$|le .+a écrit.*:?$|-{2,}\s*original message|-{2,}\s*ursprüngliche nachricht|from:\s|von:\s|sent from my )/i;

const TITLE_WORDS =
  /\b(ceo|cto|cfo|coo|cmo|cpo|ciso|vp|svp|evp|founder|co-founder|cofounder|owner|partner|managing director|director|head|lead|manager|president|chair|officer|engineer|developer|designer|consultant|analyst|associate|principal|specialist|coordinator|advisor|adviser|investor|architect|scientist|researcher|professor|recruiter|account executive|executive|editor|producer|geschäftsführer|geschäftsführerin|leiter|leiterin|gründer|gründerin|inhaber|inhaberin|berater|beraterin)\b/i;

const COMPANY_HINT =
  /\b(gmbh|ag|sa|sarl|s\.a\.|inc\.?|ltd\.?|llc|bv|b\.v\.|plc|oy|ab|as|kg|ug|labs?|ventures|capital|partners|group|holding|studio|technologies|solutions|systems|software|network|foundation|university|institute)\b/i;

const PHONE = /(?:^|[\s:])((?:\+|00)[1-9][\d\s().\/-]{6,20}\d)(?![\d])/;
const LINKEDIN = /linkedin\.com\/in\/([\p{L}\p{N}_\-%.]+)/iu;
const SPLIT_ROLE_ORG = /\s*(?:\||·|•|,|\bat\b|@|\s[-–—]\s)\s*/i;

/** The lines of the newest message, before any quoted reply. */
function ownLines(body: string): string[] {
  const lines: string[] = [];
  for (const line of body.replace(/\r/g, "").split("\n")) {
    const trimmed = line.trim();
    if (QUOTE_START.test(trimmed)) break;
    if (trimmed) lines.push(trimmed);
  }
  return lines.slice(-15);
}

function cleanPart(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned && cleaned.length <= 120 ? cleaned : undefined;
}

/**
 * Title, company, phone and LinkedIn from the signature of a message, when a
 * signature says so plainly. A title needs a title word; a company needs to
 * follow the title or look like one. Anything less is left to enrichment.
 */
export function parseSignature(
  body: string,
  senderName: string | null,
): Signature {
  const lines = ownLines(body);
  if (lines.length === 0) return {};
  const signature: Signature = {};
  const joined = lines.join("\n");
  const phone = PHONE.exec(joined)?.[1];
  if (phone) signature.phone = phone.replace(/\s+/g, " ").trim();
  const linkedIn = LINKEDIN.exec(joined)?.[1];
  if (linkedIn)
    signature.linkedIn = `https://www.linkedin.com/in/${linkedIn.replace(/[.)]+$/, "")}`;

  const first = senderName?.split(" ")[0]?.toLowerCase();
  const nameAt = senderName
    ? lines.findIndex((line) => {
        const lower = line.toLowerCase();
        return (
          lower === senderName.toLowerCase() ||
          lower.startsWith(senderName.toLowerCase()) ||
          (first !== undefined && first.length > 2 && lower === first)
        );
      })
    : -1;
  if (nameAt < 0) return signature;
  const titleLine = lines[nameAt + 1];
  if (!titleLine || !TITLE_WORDS.test(titleLine) || titleLine.length > 140)
    return signature;
  const [rolePart, ...rest] = titleLine.split(SPLIT_ROLE_ORG);
  const role = cleanPart(rolePart);
  if (role && TITLE_WORDS.test(role)) signature.role = role;
  const sameLineOrg = cleanPart(rest.join(" "));
  const nextLine = lines[nameAt + 2];
  const organization =
    sameLineOrg && !TITLE_WORDS.test(sameLineOrg)
      ? sameLineOrg
      : nextLine &&
          COMPANY_HINT.test(nextLine) &&
          !PHONE.test(nextLine) &&
          !/https?:|www\.|@/.test(nextLine)
        ? cleanPart(nextLine)
        : undefined;
  if (organization) signature.organization = organization;
  return signature;
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
  /** Empty when X left it out. */
  id: string;
  conversationId: string;
  senderId: string;
  participantIds: string[];
  createdAt: string;
  /** Only when the read asked for it. */
  text: string;
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
    id: text(field(raw, "id")),
    conversationId,
    senderId,
    participantIds: list(field(raw, "participant_ids")).map(text),
    createdAt,
    text: text(field(raw, "text")),
  };
}

/**
 * What a DM walk learned so far, small enough for the capture cursor: who
 * wrote on which day in each conversation (no message text), and the people
 * in them. A conversation too large to count stays as a marker only, and past
 * `X_WALK_CONVERSATIONS` the contacts are written and only the current day's
 * talk is kept.
 */
export interface XDmWalk {
  /** The next page; null before the first. */
  token: string | null;
  /** It read back to `from`; only the contacts are left to write. */
  reached: boolean;
  /** The newest event it read, kept as `newestDmId` once it finishes. */
  newestId: string | null;
  /** Everything after this was read once the walk finishes. */
  startedAt: string;
  talk: Record<
    string,
    { members: string[]; days: Record<string, string[]>; large?: true }
  >;
  users: Record<string, { name: string | null; username: string }>;
}

/**
 * Conversations a walk holds before it writes their contacts and keeps only
 * the current day's; one day with more keeps all of that day's.
 */
export const X_WALK_CONVERSATIONS = 300;

export function newXDmWalk(startedAt: string): XDmWalk {
  return {
    token: null,
    reached: false,
    newestId: null,
    startedAt,
    talk: {},
    users: {},
  };
}

/**
 * The walk with one more page: its events and the people a kept conversation
 * names. A copy, so a caller commits it only once the page is fully handled.
 * Nothing is left out. `overflow`: it now holds more than
 * `X_WALK_CONVERSATIONS`; the caller writes its contacts and keeps
 * `keepXDmDay` of it.
 */
export function addXDmPage(
  walk: XDmWalk,
  page: { events: readonly XDmEvent[]; users: readonly XUser[] },
): { walk: XDmWalk; overflow: boolean } {
  const next: XDmWalk = structuredClone(walk);
  for (const event of page.events) {
    let conversation = next.talk[event.conversationId];
    if (!conversation) {
      conversation = { members: [], days: {} };
      next.talk[event.conversationId] = conversation;
    }
    if (conversation.large) continue;
    const pair = event.conversationId.split("-");
    conversation.members = [
      ...new Set([
        ...conversation.members,
        ...event.participantIds,
        ...(pair.length === 2 ? pair : []),
        event.senderId,
      ]),
    ];
    // The owner plus more than a small group: never a conversation.
    if (conversation.members.length > X_SMALL_GROUP + 1) {
      next.talk[event.conversationId] = { members: [], days: {}, large: true };
      continue;
    }
    const day = event.createdAt.slice(0, 10);
    conversation.days[day] = [
      ...new Set([...(conversation.days[day] ?? []), event.senderId]),
    ];
  }
  const named = new Set(
    Object.values(next.talk).flatMap((conversation) => conversation.members),
  );
  for (const user of page.users)
    if (named.has(user.id))
      next.users[user.id] = { name: user.name, username: user.username };
  return {
    walk: next,
    overflow: Object.keys(next.talk).length > X_WALK_CONVERSATIONS,
  };
}

/**
 * After its contacts were written, the part of a walk later pages can still
 * add to: pages go back in time, so only conversations with talk on `day`
 * (the oldest day read so far), with that day alone, and their people.
 */
export function keepXDmDay(walk: XDmWalk, day: string): XDmWalk {
  const talk: XDmWalk["talk"] = {};
  for (const [id, conversation] of Object.entries(walk.talk)) {
    const senders = conversation.days[day];
    if (senders)
      talk[id] = { members: conversation.members, days: { [day]: senders } };
  }
  const named = new Set(
    Object.values(talk).flatMap((conversation) => conversation.members),
  );
  return {
    ...walk,
    talk,
    users: Object.fromEntries(
      Object.entries(walk.users).filter(([id]) => named.has(id)),
    ),
  };
}

/** One event per person and day, as `extractXDms` reads them. */
export function xDmWalkEvents(walk: XDmWalk): XDmEvent[] {
  return Object.entries(walk.talk).flatMap(([conversationId, conversation]) =>
    Object.entries(conversation.days).flatMap(([day, senders]) =>
      senders.map((senderId) => ({
        id: "",
        conversationId,
        senderId,
        participantIds: conversation.members,
        createdAt: `${day}T12:00:00.000Z`,
        text: "",
      })),
    ),
  );
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
