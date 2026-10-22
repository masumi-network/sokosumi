/**
 * Turns raw provider payloads (Composio's Gmail, Outlook, Google Calendar and
 * Slack responses) into capture candidates: a person, their channels, and
 * one interaction with the teammate who had it. Pure, so every extractor is
 * tested on recorded fixtures.
 */
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
  type: "EMAIL" | "PHONE" | "LINKEDIN" | "SLACK";
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
    channel: "EMAIL" | "MEETING" | "SLACK";
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

/** Plain text for reading a signature; never rendered as HTML. */
function stripHtml(html: string): string {
  let text = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/tr|\/li)[^>]*>/gi, "\n");
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  } while (text !== previous);
  return (
    text
      .replace(/[<>]/g, " ")
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
