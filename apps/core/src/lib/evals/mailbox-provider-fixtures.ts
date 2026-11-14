import { createHash } from "node:crypto";
import { getSokoBotIntegrationProvider } from "@sokosumi/soko-bot";
import { z } from "zod";
import type { MailboxFixtureBinding } from "./mailbox-binding";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const TIME_ZONE = "Europe/Berlin";
const GMAIL_DATE_TIME_ZONE = "Etc/GMT+8";
const MAX_QUERY_LENGTH = 2_048;
const MAX_QUERY_TERMS = 128;
const MAX_QUERY_DEPTH = 8;
const PAGE_PREFIX = "eval-mail-page";
const PAGE_LIMIT = 100;
const CASES = new Set([
  "inbox-summary",
  "calendar-prep",
  "standup-with-inbox",
  "mail-delta",
  "quiet-standup",
  "quiet-delta",
  "autonomous-meeting-prep",
]);
const ACTIONABLE_CASES = new Set([
  "inbox-summary",
  "standup-with-inbox",
  "mail-delta",
]);
const pageSizeSchema = z.number().int().min(1).max(PAGE_LIMIT).default(20);
const listMailSchema = z
  .object({
    query: z.string().max(MAX_QUERY_LENGTH).default(""),
    max_results: pageSizeSchema,
    page_token: z.string().min(1).max(256).optional(),
    include_payload: z.boolean().optional(),
    verbose: z.boolean().optional(),
  })
  .strict();
const readMailSchema = z
  .object({
    message_id: z.string().min(1),
    format: z.enum(["full", "minimal", "metadata"]).default("full"),
  })
  .strict();
const calendarSchema = z
  .object({
    calendar_id: z.literal("primary").default("primary"),
    timeMin: z.iso.datetime({ offset: true }),
    timeMax: z.iso.datetime({ offset: true }),
    max_results: pageSizeSchema,
    page_token: z.string().min(1).max(256).optional(),
    single_events: z.literal(true).optional(),
    order_by: z.literal("startTime").optional(),
  })
  .strict();

interface Message {
  messageId: string;
  threadId: string;
  messageTimestamp: string;
  sender: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string;
  messageText: string;
  labelIds: string[];
  payload: { headers: Array<{ name: string; value: string }> };
}

interface CalendarEvent {
  id: string;
  status: "confirmed";
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  organizer: { email: string; self: boolean };
  attendees: Array<{ email: string; self?: boolean; responseStatus: string }>;
}

function invalid(detail: string): never {
  throw new Error(`Unsupported mailbox fixture request: ${detail}`);
}

function ownerEmail(binding: MailboxFixtureBinding) {
  // This is the registered lane identity, not a new connected account.
  return `evals+lane${binding.repeat}@sokosumi.com`;
}

/** Resolve an unambiguous local hour, including the next day's DST offset. */
function localHour(
  year: number,
  month: number,
  day: number,
  hour: number,
  zone: string,
) {
  const candidate = new Date(Date.UTC(year, month - 1, day, hour));
  const name = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    timeZoneName: "longOffset",
  })
    .formatToParts(candidate)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? "");
  if (!match && name !== "GMT") invalid("timezone offset");
  const offset = match
    ? (Number(match[2]) * 60 + Number(match[3])) *
      MINUTE_MS *
      (match[1] === "+" ? 1 : -1)
    : 0;
  return new Date(candidate.getTime() - offset);
}

function tomorrowAt(referenceTime: string, hour: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(referenceTime));
  const part = (type: string) =>
    Number(parts.find((value) => value.type === type)?.value);
  const tomorrow = new Date(
    Date.UTC(part("year"), part("month") - 1, part("day") + 1),
  );
  return localHour(
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth() + 1,
    tomorrow.getUTCDate(),
    hour,
    TIME_ZONE,
  );
}

function fixtureMessages(binding: MailboxFixtureBinding): Message[] {
  const now = Date.parse(binding.referenceTime);
  const owner = ownerEmail(binding);
  const make = (
    key: string,
    minutesAgo: number,
    sender: string,
    subject: string,
    body: string,
    labels: string[],
  ): Message => ({
    messageId: `eval-mail:${binding.resultId}:${key}`,
    threadId: `eval-thread:${binding.resultId}:${key}`,
    messageTimestamp: new Date(now - minutesAgo * MINUTE_MS).toISOString(),
    sender,
    to: [owner],
    cc: [],
    subject,
    snippet: body,
    messageText: body,
    labelIds: labels,
    payload: {
      headers: [
        { name: "From", value: sender },
        { name: "To", value: owner },
        ...(labels.includes("CATEGORY_PROMOTIONS")
          ? [
              {
                name: "List-Unsubscribe",
                value: "<https://newsletter.example.invalid/unsubscribe>",
              },
            ]
          : []),
      ],
    },
  });
  const bulk = [
    make(
      "newsletter",
      60,
      "Product Weekly <newsletter@example.invalid>",
      "Weekly product newsletter",
      "This automated weekly newsletter lists product updates. No reply or action is requested.",
      ["INBOX", "CATEGORY_PROMOTIONS"],
    ),
    make(
      "receipt",
      90,
      "Billing <billing@example.invalid>",
      "Payment receipt",
      "Automatic receipt: your subscription payment was received. Nothing is due and no reply is needed.",
      ["INBOX", "CATEGORY_UPDATES"],
    ),
    make(
      "notification",
      120,
      "Build service <notifications@example.invalid>",
      "Build notification: checks passed",
      "Automatic notification: all build checks passed. This is information only; no action is needed.",
      ["INBOX", "CATEGORY_UPDATES"],
    ),
  ];
  const actionable = ACTIONABLE_CASES.has(binding.caseId)
    ? [
        make(
          "headline",
          5,
          "Hannah Weber <hannah.weber@example.invalid>",
          "Launch brief: headline approval today",
          "Hi Robin, please approve headline option A for the launch brief today by 16:00 Europe/Berlin. The release copy is blocked on your decision. A short reply with your choice is enough. Hannah",
          ["INBOX", "UNREAD", "IMPORTANT"],
        ),
        make(
          "agenda",
          30,
          "Alex Kim <alex.kim@example.invalid>",
          "Launch briefing agenda",
          "Hi Robin, here is the agenda we discussed: launch headline, competitor pricing, and release timing. This is background for your briefing; nothing needs a reply today. Alex",
          ["INBOX"],
        ),
      ]
    : [];
  const sent = make(
    "sent",
    240,
    `Robin Keller <${owner}>`,
    "Re: research archive",
    "Thanks Alex. I filed last week's research archive. No follow-up is needed.",
    ["SENT"],
  );
  sent.to = ["alex.kim@example.invalid"];
  sent.payload.headers[1].value = sent.to[0];
  return [...actionable, ...bulk, ...(actionable.length ? [sent] : [])];
}

function fixtureEvents(binding: MailboxFixtureBinding): CalendarEvent[] {
  const owner = ownerEmail(binding);
  const make = (
    key: string,
    start: Date,
    owned: boolean,
    summary: string,
    description: string,
  ): CalendarEvent => ({
    id: `eval-event:${binding.resultId}:${key}`,
    status: "confirmed",
    summary,
    description,
    start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
    end: {
      dateTime: new Date(start.getTime() + HOUR_MS).toISOString(),
      timeZone: TIME_ZONE,
    },
    organizer: { email: owned ? owner : "nina@example.invalid", self: owned },
    attendees: [
      { email: owner, self: true, responseStatus: "accepted" },
      { email: "hannah.weber@example.invalid", responseStatus: "accepted" },
      { email: "nina@example.invalid", responseStatus: "accepted" },
    ],
  });
  const agenda =
    "Robin Keller owns the agenda and leads this meeting. Prepare a one-page decision brief comparing competitor pricing, two launch headline options, and a release timing recommendation. Hannah handles research; Alex handles writing. The brief must be ready before this meeting.";
  if (binding.caseId === "calendar-prep")
    return [
      make(
        "launch",
        tomorrowAt(binding.referenceTime, 10),
        true,
        "Launch decision meeting",
        agenda,
      ),
      make(
        "partner",
        tomorrowAt(binding.referenceTime, 15),
        false,
        "Partner product update",
        "Nina presents a partner update. Robin attends as a listener. No presentation or preparation is requested from Robin.",
      ),
    ];
  if (binding.caseId === "autonomous-meeting-prep")
    return [
      make(
        "launch",
        new Date(Date.parse(binding.referenceTime) + 2 * HOUR_MS),
        true,
        "Launch decision meeting",
        agenda,
      ),
    ];
  if (binding.caseId === "standup-with-inbox")
    return [
      make(
        "partner",
        new Date(Date.parse(binding.referenceTime) + HOUR_MS),
        false,
        "Partner product update",
        "Nina presents. Robin attends as a listener; no preparation is needed.",
      ),
    ];
  return [];
}

function dateBound(value: string): number {
  if (/^\d+$/.test(value)) {
    const timestamp = Number(value) * 1_000;
    if (
      !Number.isSafeInteger(timestamp) ||
      !Number.isFinite(new Date(timestamp).getTime())
    )
      invalid("date boundary");
    return timestamp;
  }
  const match = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(value);
  if (!match) invalid("date boundary");
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  )
    invalid("date boundary");
  // The Gmail filtering guide specifies midnight PST. Epoch bounds are absolute.
  return localHour(year, month, day, 0, GMAIL_DATE_TIME_ZONE).getTime();
}

type Predicate = (message: Message) => boolean;

function termPredicate(
  term: string,
  binding: MailboxFixtureBinding,
): Predicate {
  if (term.startsWith("-")) {
    if (term.length === 1 || term.startsWith("--"))
      invalid("empty or nested exclusion");
    const positive = termPredicate(term.slice(1), binding);
    return (message) => !positive(message);
  }
  const separator = term.indexOf(":");
  if (separator < 0)
    return (message) =>
      [
        message.sender,
        ...message.to,
        ...message.cc,
        message.subject,
        message.messageText,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term.toLowerCase());
  const operator = term.slice(0, separator).toLowerCase();
  const value = term.slice(separator + 1).toLowerCase();
  if (!value) invalid("empty query operand");
  const address = value === "me" ? ownerEmail(binding).toLowerCase() : value;
  if (operator === "from")
    return (message) => message.sender.toLowerCase().includes(address);
  if (operator === "to")
    return (message) =>
      message.to.some((entry) => entry.toLowerCase().includes(address));
  if (operator === "cc")
    return (message) =>
      message.cc.some((entry) => entry.toLowerCase().includes(address));
  if (operator === "subject")
    return (message) => message.subject.toLowerCase().includes(value);
  if (["after", "newer", "before", "older"].includes(operator)) {
    const bound = dateBound(value);
    return (message) =>
      ["after", "newer"].includes(operator)
        ? Date.parse(message.messageTimestamp) >= bound
        : Date.parse(message.messageTimestamp) < bound;
  }
  if (operator === "newer_than" || operator === "older_than") {
    const match = /^(\d+)d$/.exec(value);
    if (
      !match ||
      !Number.isSafeInteger(Number(match[1])) ||
      Number(match[1]) > 365
    )
      invalid("relative date; use 0d through 365d");
    const bound = Date.parse(binding.referenceTime) - Number(match[1]) * DAY_MS;
    return (message) =>
      operator === "newer_than"
        ? Date.parse(message.messageTimestamp) >= bound
        : Date.parse(message.messageTimestamp) < bound;
  }
  if (operator === "in" && ["inbox", "sent", "anywhere"].includes(value))
    return (message) =>
      value === "anywhere" || message.labelIds.includes(value.toUpperCase());
  if (operator === "is" && ["unread", "read", "important"].includes(value))
    return (message) =>
      value === "read"
        ? !message.labelIds.includes("UNREAD")
        : message.labelIds.includes(value.toUpperCase());
  if (
    operator === "label" &&
    ["inbox", "sent", "unread", "important"].includes(value)
  )
    return (message) => message.labelIds.includes(value.toUpperCase());
  if (
    operator === "category" &&
    ["promotions", "updates", "primary", "social", "forums"].includes(value)
  )
    return (message) =>
      value === "primary"
        ? !message.labelIds.some((label) => label.startsWith("CATEGORY_"))
        : message.labelIds.includes(`CATEGORY_${value.toUpperCase()}`);
  if (operator === "filename" || (operator === "has" && value === "attachment"))
    return () => false;
  return invalid(`query operator ${operator}:${value}`);
}

/** Gmail's bounded fixture syntax: AND, OR, brace alternatives and quoted terms. */
function mailQuery(query: string, binding: MailboxFixtureBinding): Predicate {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  const flush = () => {
    if (current) tokens.push(current);
    current = "";
  };
  for (const char of query) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "\\") invalid("escaped query text");
    if (!quoted && /\s/.test(char)) {
      flush();
      continue;
    }
    if (!quoted && "{}()".includes(char)) {
      flush();
      tokens.push(char);
      continue;
    }
    current += char;
  }
  flush();
  if (quoted || tokens.length > MAX_QUERY_TERMS) invalid("malformed query");
  let position = 0;
  const atom = (depth: number): Predicate => {
    if (depth > MAX_QUERY_DEPTH) invalid("query nesting limit");
    const token = tokens[position++];
    if (!token || ["}", ")", "OR", "AND"].includes(token))
      invalid("malformed query expression");
    if (token === "{") {
      const alternatives: Predicate[] = [];
      while (tokens[position] !== "}") {
        if (position >= tokens.length) invalid("unclosed query alternatives");
        alternatives.push(atom(depth + 1));
      }
      position++;
      if (!alternatives.length) invalid("empty query alternatives");
      return (message) => alternatives.some((predicate) => predicate(message));
    }
    if (token === "(") {
      const predicate = or(depth + 1);
      if (tokens[position++] !== ")") invalid("unclosed query group");
      return predicate;
    }
    return termPredicate(token, binding);
  };
  const and = (depth: number): Predicate => {
    const predicates = [atom(depth)];
    while (
      position < tokens.length &&
      !["OR", ")", "}"].includes(tokens[position])
    ) {
      if (tokens[position] === "AND") position++;
      predicates.push(atom(depth));
    }
    return (message) => predicates.every((predicate) => predicate(message));
  };
  const or = (depth: number): Predicate => {
    const predicates = [and(depth)];
    while (tokens[position] === "OR") {
      position++;
      predicates.push(and(depth));
    }
    return (message) => predicates.some((predicate) => predicate(message));
  };
  if (!tokens.length) return () => true;
  const predicate = or(0);
  if (position !== tokens.length) invalid("unexpected query token");
  return predicate;
}

function page<T>(
  rows: T[],
  binding: MailboxFixtureBinding,
  kind: string,
  args: Record<string, unknown>,
  size: number,
  token?: string,
) {
  const { page_token: _token, ...filters } = args;
  const digest = createHash("sha256")
    .update(JSON.stringify({ binding, kind, filters }))
    .digest("hex");
  const prefix = `${PAGE_PREFIX}:${digest}:`;
  const offsetText = token?.startsWith(prefix)
    ? token.slice(prefix.length)
    : "";
  const offset = token ? Number(offsetText) : 0;
  if (
    token &&
    (!offsetText ||
      !/^\d+$/.test(offsetText) ||
      !Number.isSafeInteger(offset) ||
      offset <= 0 ||
      offset >= rows.length ||
      offset % size !== 0)
  )
    invalid("page token belongs to another query, result or page");
  const next = offset + size;
  return {
    rows: rows.slice(offset, next),
    ...(next < rows.length ? { nextPageToken: `${prefix}${next}` } : {}),
  };
}

/** Raw provider reads only. Core still owns normalization, triage and tool policy. */
export function executeMailboxFixture(
  binding: MailboxFixtureBinding,
  providerId: string,
  slug: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!CASES.has(binding.caseId)) invalid("case has no mailbox fixture");
  if (!Number.isFinite(Date.parse(binding.referenceTime)))
    invalid("reference time");
  const provider = getSokoBotIntegrationProvider(providerId);
  if (providerId === "gmail" && slug === provider?.tools.listMessages) {
    const parsed = listMailSchema.parse(args);
    const predicate = mailQuery(parsed.query, binding);
    const messages = fixtureMessages(binding).filter(predicate);
    const result = page(
      messages,
      binding,
      slug,
      parsed,
      parsed.max_results,
      parsed.page_token,
    );
    return {
      messages: result.rows,
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    };
  }
  if (providerId === "gmail" && slug === provider?.tools.getMessage) {
    const parsed = readMailSchema.parse(args);
    const message = fixtureMessages(binding).find(
      (entry) => entry.messageId === parsed.message_id,
    );
    if (!message) invalid("message ID is not in this result");
    if (parsed.format === "full") return { message };
    const { messageText: _body, snippet: _snippet, ...metadata } = message;
    return { message: metadata };
  }
  if (providerId === "googlecalendar" && slug === provider?.tools.listEvents) {
    const parsed = calendarSchema.parse(args);
    const from = Date.parse(parsed.timeMin);
    const to = Date.parse(parsed.timeMax);
    if (to <= from) invalid("calendar end must follow start");
    const events = fixtureEvents(binding).filter(
      (event) =>
        Date.parse(event.end.dateTime) > from &&
        Date.parse(event.start.dateTime) < to,
    );
    const result = page(
      events,
      binding,
      slug,
      parsed,
      parsed.max_results,
      parsed.page_token,
    );
    return {
      items: result.rows,
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    };
  }
  return invalid(`${providerId} operation ${slug}`);
}
