import type { SokoBotInboxMessage } from "@sokosumi/soko-bot";
import {
  contactDetailHref,
  escapeMarkdownLinkLabel,
  findBareHttpUrlHits,
  normalizeContactChannelValue,
} from "@sokosumi/utils";
import { mailTopic, parseMail } from "@/lib/contacts/capture-extract";
import {
  emailDomain,
  FREEMAIL_DOMAINS,
  isCalendarNoticeSubject,
} from "@/lib/contacts/capture-filters";
import { field, text } from "@/lib/contacts/capture-provider";
import prisma from "@/lib/db/prisma";
import {
  type RhythmScopeBot,
  rhythmTaskScope,
} from "@/lib/soko-bot/rhythm-task-scope";
import { confirmedMeetingContacts } from "@/services/contacts-context.service";
import {
  activeIntegrationsForBot,
  fetchInboxPage,
} from "@/services/soko-bot-integrations.service";
import {
  type MeetingCalendarEvent,
  meetingCalendarEvents,
} from "@/services/soko-bot-meeting-calendar.service";
import {
  mailLine,
  ownerEmail,
  when,
} from "@/services/soko-bot-rhythm-context.service";
import type {
  RhythmBot,
  RhythmPacket,
} from "@/services/soko-bot-rhythms.service";

const SLOT_MS = 30 * 60 * 1_000;
const MEETING_GUEST_LIMIT = 6;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MEETING_MAIL_LOOKBACK_DAYS = 365;
const TITLE_MATCH_LOOKBACK_DAYS = 7;
const MEETING_MAIL_SEARCH_LIMIT = 8;
const MEETING_MAIL_PREVIEW_CHARS = 400;
const MEETING_MAIL_REFERENCE_CHARS = 20_000;
const MEETING_TASK_LIMIT = 5;
const MEETING_TASK_PAGE_SIZE = 50;
const CONSUMER_GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

interface MeetingMail extends SokoBotInboxMessage {
  /** Only used to reject a reference to a different occurrence. Never sent to the model. */
  referenceBody: string;
}

/** Mail from or to one address, in each provider's search syntax. */
async function readGuestMail(
  botId: string,
  guest: string,
  slotAt: Date,
): Promise<MeetingMail[]> {
  const messages: MeetingMail[] = [];
  for (const account of await activeIntegrationsForBot(botId, "email")) {
    const query =
      account.provider.id === "gmail"
        ? `{from:${guest} to:${guest}} -filename:ics`
        : `participants:${guest} AND received<${slotAt.toISOString()}`;
    const page = await fetchInboxPage(account, {
      query,
      since: new Date(slotAt.getTime() - MEETING_MAIL_LOOKBACK_DAYS * DAY_MS),
      before: slotAt,
      limit: MEETING_MAIL_SEARCH_LIMIT,
      includePayload: true,
    }).catch(() => null);
    if (!page) continue;
    const envelopes = new Map(
      page.raw.flatMap((raw) => {
        // Check the complete body for conflicting links, including HTML link targets.
        const body =
          text(field(field(raw, "body"), "content")) ||
          text(field(raw, "messageText", "text"));
        if (body.length > MEETING_MAIL_REFERENCE_CHARS) return [];
        const envelope = parseMail(raw);
        if (!envelope) return [];
        const referenceBody = (body || envelope.body).replaceAll("&amp;", "&");
        return [[envelope.id, { ...envelope, referenceBody }] as const];
      }),
    );
    for (const message of page.messages) {
      const envelope = envelopes.get(message.id);
      if (!envelope?.from) continue;
      messages.push({
        ...message,
        from: envelope.from.email,
        to: envelope.to.map(({ email }) => email),
        subject: envelope.subject,
        snippet:
          message.snippet.trim() ||
          envelope.body
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, MEETING_MAIL_PREVIEW_CHARS),
        receivedAt: envelope.occurredAt,
        referenceBody: envelope.referenceBody,
      });
    }
  }
  return messages;
}

function isCalendarEventLink(link: string): boolean {
  const url = URL.parse(link);
  if (!url) return false;
  if (
    url.hostname === "calendar.google.com" ||
    url.hostname === "www.google.com"
  )
    return (
      /(?:^|\/)(?:event|eventedit)(?:\/|$)/i.test(url.pathname) ||
      url.searchParams.has("eid")
    );
  if (
    !/^outlook\.(?:office(?:365)?\.com|live\.com|cloud\.microsoft)$/.test(
      url.hostname,
    )
  )
    return false;
  return (
    /\/calendar\/(?:\d+\/)?(?:deeplink\/)?(?:item|read)(?:\/|$)/i.test(
      url.pathname,
    ) ||
    url.searchParams.get("path")?.toLowerCase() === "/calendar/item" ||
    (/^\/owa\/?$/i.test(url.pathname) &&
      [...url.searchParams.keys()].some(
        (key) => key.toLowerCase() === "itemid",
      ))
  );
}

/** An explicit event reference takes precedence over a matching subject or attendee. */
function matchesLinkedMeeting(
  text: string,
  event: MeetingCalendarEvent,
  events: readonly MeetingCalendarEvent[],
): boolean | undefined {
  const links = findBareHttpUrlHits(text).map(({ url }) => url);
  const eventLinks = links.filter(
    (link) =>
      events.some((item) => item.link === link) || isCalendarEventLink(link),
  );
  if (!eventLinks.length) return undefined;
  return (
    eventLinks.every((link) => link === event.link) &&
    !events.some((other) => other !== event && other.link === event.link)
  );
}

/** Invitations and RSVPs say a meeting exists, not what was said. */
function isMailForMeeting(
  message: MeetingMail,
  guest: string,
  ownerMailboxes: ReadonlySet<string>,
  event: MeetingCalendarEvent,
  events: readonly MeetingCalendarEvent[],
  slotAt: Date,
): boolean {
  const subject = mailTopic(message.subject);
  if (isCalendarNoticeSubject(subject)) return false;
  const ageDays = (slotAt.getTime() - Date.parse(message.receivedAt)) / DAY_MS;
  if (!(ageDays >= 0 && ageDays <= MEETING_MAIL_LOOKBACK_DAYS)) return false;
  const inbound =
    message.from === guest &&
    message.to.some((email) => ownerMailboxes.has(mailboxKey(email)));
  const outbound =
    ownerMailboxes.has(mailboxKey(message.from)) && message.to.includes(guest);
  if (!inbound && !outbound) return false;

  const linked = matchesLinkedMeeting(
    `${message.subject}\n${message.snippet}`,
    event,
    events,
  );
  if (matchesLinkedMeeting(message.referenceBody, event, events) === false)
    return false;
  if (linked !== undefined) return linked;
  // Recurring meetings reuse their title. Only an event link can place older mail.
  if (event.recurring || ageDays > TITLE_MATCH_LOOKBACK_DAYS) return false;
  const titled = events.filter(
    (item) => subject.toLowerCase() === item.title.trim().toLowerCase(),
  );
  return titled.length === 1 && titled[0] === event;
}

function mentions(text: string, term: string) {
  const characters = "[\\p{L}\\p{N}]";
  return (
    term.length > 0 &&
    new RegExp(
      `(?<!${characters})${RegExp.escape(term)}(?!${characters})`,
      "iu",
    ).test(text)
  );
}

/**
 * Prefer a unique event link in the Task title, then a unique invitation title.
 * A guest address alone cannot distinguish this meeting from a different slot.
 */
async function openTasksForMeeting(
  bot: RhythmScopeBot,
  event: MeetingCalendarEvent,
  events: readonly MeetingCalendarEvent[],
) {
  const title = event.title.trim();
  const hasUniqueTitle =
    !event.recurring &&
    title.length > 0 &&
    !events.some(
      (other) =>
        other !== event &&
        other.title.trim().toLowerCase() === title.toLowerCase(),
    );
  const names = [];
  if (event.link) names.push({ contains: event.link });
  if (hasUniqueTitle)
    names.push(/\s/.test(title) ? { contains: title } : { equals: title });
  if (!names.length) return [];
  function matches(name: string) {
    const linked = matchesLinkedMeeting(name, event, events);
    if (linked !== undefined) return linked;
    if (event.recurring) return false;
    const titled = events.filter(({ title }) =>
      /\s/.test(title.trim())
        ? mentions(name, title)
        : name.toLowerCase() === title.toLowerCase(),
    );
    return titled.length === 1 && titled[0] === event;
  }

  const matched = [];
  let cursor: string | undefined;
  do {
    const tasks = await prisma.task.findMany({
      where: {
        workspaceId: bot.workspaceId,
        archivedAt: null,
        status: { notIn: ["COMPLETED", "CANCELED"] },
        OR: names.map((name) => ({
          name: { ...name, mode: "insensitive" as const },
        })),
        AND: [rhythmTaskScope(bot).visible],
      },
      select: { id: true, name: true, status: true },
      take: MEETING_TASK_PAGE_SIZE,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const task of tasks) {
      if (matches(task.name)) matched.push(task);
      if (matched.length === MEETING_TASK_LIMIT) return matched;
    }
    cursor =
      tasks.length === MEETING_TASK_PAGE_SIZE ? tasks.at(-1)?.id : undefined;
  } while (cursor);
  return matched;
}

/** Plus tags, dots and googlemail.com route to the same consumer Gmail inbox. */
function mailboxKey(email: string): string {
  const address = email.toLowerCase();
  const [local, domain] = address.split("@");
  if (
    !local ||
    !domain ||
    !CONSUMER_GMAIL_DOMAINS.has(domain) ||
    !normalizeContactChannelValue("EMAIL", address)
  )
    return address;
  return `${local.replace(/\+.*/, "").replaceAll(".", "")}@gmail.com`;
}

/**
 * External meetings starting 30–60 minutes after this run's half-hour slot.
 * The cron fires every half hour, so the windows tile the day and each
 * meeting is briefed exactly once, retries included.
 */
export async function meetingPrep(
  bot: RhythmBot,
  slotAt: Date,
): Promise<RhythmPacket> {
  const slot = Math.floor(slotAt.getTime() / SLOT_MS) * SLOT_MS;
  const fetched = await meetingCalendarEvents(
    bot.id,
    new Date(slot + SLOT_MS),
    new Date(slot + 2 * SLOT_MS),
    10,
  );
  const events = fetched.filter((event) => {
    const start = Date.parse(event.startsAt);
    return (
      !event.allDay && start >= slot + SLOT_MS && start < slot + 2 * SLOT_MS
    );
  });
  if (!events.length) return { lines: [], skip: true };
  const attendeeEmails = [
    ...new Set(
      events.flatMap((event) => event.guests.map(({ email }) => email)),
    ),
  ];
  if (!attendeeEmails.length) return { lines: [], skip: true };
  const exactAttendees = {
    email: { in: attendeeEmails, mode: "insensitive" as const },
  };
  const invitedGmail = attendeeEmails.some((email) =>
    CONSUMER_GMAIL_DOMAINS.has(emailDomain(email)),
  );
  const memberAddresses = invitedGmail
    ? {
        OR: [
          exactAttendees,
          ...[...CONSUMER_GMAIL_DOMAINS].map((domain) => ({
            email: { endsWith: `@${domain}`, mode: "insensitive" as const },
          })),
        ],
      }
    : exactAttendees;
  const [owner, members] = await Promise.all([
    ownerEmail(bot),
    prisma.member.findMany({
      where: {
        organization: { workspace: { id: bot.workspaceId } },
        user: { emailVerified: true, ...memberAddresses },
      },
      select: { user: { select: { email: true } } },
    }),
  ]);
  const memberMailboxes = new Set(
    members.map(({ user }) => mailboxKey(user.email)),
  );
  const ownerEmails = new Set(fetched.flatMap((event) => event.selfEmails));
  if (owner) ownerEmails.add(owner);
  const ownerMailboxes = new Set([...ownerEmails].map(mailboxKey));
  for (const email of attendeeEmails) {
    if (ownerMailboxes.has(mailboxKey(email))) ownerEmails.add(email);
  }
  const ownDomain = owner ? emailDomain(owner) : "";
  const possibleAliasLocals = new Set(
    [...ownerEmails]
      .map((email) => email.split("@")[0])
      .filter((local) => local?.includes(".")),
  );
  const lines: string[] = [];
  const mailByGuest = new Map<string, MeetingMail[]>();
  for (const event of events) {
    const outside = event.guests.filter(
      ({ email }) =>
        !ownerEmails.has(email) &&
        !memberMailboxes.has(mailboxKey(email)) &&
        (emailDomain(email) !== ownDomain || FREEMAIL_DOMAINS.has(ownDomain)),
    );
    const possibleAliases = outside.filter(({ email }) =>
      possibleAliasLocals.has(email.split("@")[0]),
    );
    const unresolved = new Set(possibleAliases.map(({ email }) => email));
    const guests = outside
      .filter(({ email }) => !unresolved.has(email))
      .slice(0, MEETING_GUEST_LIMIT);
    const external = guests.map(({ email }) => email);
    if (external.length === 0) continue;
    // Context only: a failed lookup must not cost the meeting its prep.
    const contacts = await confirmedMeetingContacts(
      bot.workspaceId,
      guests,
    ).catch(() => null);
    const labels = guests.map(({ email, name }) => {
      if (!name) return email;
      const contact = contacts?.get(email);
      const label = escapeMarkdownLinkLabel(name);
      const guest = contact
        ? `[${label}](${contactDetailHref(contact.id, bot.workspaceId)})`
        : label;
      const role = contact?.role ? ` (${contact.role})` : "";
      return `${guest} <${email}>${role}`;
    });
    lines.push(
      `## Meeting ${when(event.startsAt, bot.ingestTimezone)}: ${event.title} [${event.provider}:${event.id}]`,
      `- From outside: ${labels.join(", ")}`,
    );
    if (unresolved.size)
      lines.push(
        `- Attendee identity unconfirmed (possible owner address): ${[...unresolved].join(", ")}`,
      );
    if (event.description)
      lines.push(
        `- Agenda: ${event.description.replace(/\s+/g, " ").slice(0, 300)}`,
      );
    // One search per person, so whoever has the most mail can't crowd the
    // others out of a shared result.
    for (const email of external.slice(0, 4)) {
      let messages = mailByGuest.get(email);
      if (!messages) {
        messages = await readGuestMail(bot.id, email, slotAt);
        mailByGuest.set(email, messages);
      }
      const recent = messages
        .filter((message) =>
          isMailForMeeting(
            message,
            email,
            ownerMailboxes,
            event,
            events,
            slotAt,
          ),
        )
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
        .slice(0, 3);
      if (recent.length > 0)
        lines.push(
          `- Earlier mail with ${email}:`,
          ...recent.map((m) => `  ${mailLine(m, bot.ingestTimezone)}`),
        );
    }
    const tasks = await openTasksForMeeting(bot, event, events);
    if (tasks.length > 0) {
      lines.push("- Related open Tasks:");
      lines.push(
        ...tasks.map(
          (task) =>
            `  - ${task.status} · "${task.name ?? "Untitled task"}" (id ${task.id})`,
        ),
      );
    }
    lines.push("");
  }
  return { lines, skip: lines.length === 0 };
}
