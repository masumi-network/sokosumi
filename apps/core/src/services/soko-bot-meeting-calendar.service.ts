import type { SokoBotCalendarEvent } from "@sokosumi/soko-bot";
import { normalizeContactChannelValue } from "@sokosumi/utils";
import {
  type MailAddress,
  parseAddresses,
  parseCalendarAttendee,
  parseEvent,
} from "@/lib/contacts/capture-provider";
import { WINDOWS_TIME_ZONES } from "@/lib/contacts/windows-time-zones";
import prisma from "@/lib/db/prisma";
import { uniqueGuests } from "@/lib/soko-bot/integration-addresses";
import {
  activeIntegrationsForBot,
  fetchCalendarPage,
} from "@/services/soko-bot-integrations.service";

export interface MeetingCalendarEvent extends SokoBotCalendarEvent {
  guests: MailAddress[];
  selfEmails: string[];
  recurring: boolean;
}

const NON_MEETING_EVENT_TYPES = new Set([
  "birthday",
  "focusTime",
  "outOfOffice",
  "workingLocation",
]);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function meetingStart(
  rawStart: unknown,
  parsed: { startsAt: string; allDay: boolean },
): string | null {
  const start = record(rawStart);
  const time = typeof rawStart === "string" ? rawStart : start.dateTime;
  if (
    parsed.allDay ||
    (typeof start.timeZone === "string" && /^utc$/i.test(start.timeZone)) ||
    (typeof time === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(time))
  )
    return parsed.startsAt;
  // Graph's wall clock has no UTC offset. A missing, unknown or ambiguous zone
  // cannot place the meeting in a half-hour slot.
  if (typeof time !== "string" || typeof start.timeZone !== "string")
    return null;
  const zone = WINDOWS_TIME_ZONES.get(start.timeZone) ?? start.timeZone;
  try {
    return Temporal.PlainDateTime.from(time)
      .toZonedDateTime(zone, { disambiguation: "reject" })
      .toInstant()
      .toString({ smallestUnit: "millisecond" });
  } catch {
    return null;
  }
}

function meetingIdentity(raw: unknown) {
  const event = parseEvent(raw, "invitation");
  if (!event) return null;
  const fields = record(raw);
  const ownerOrganized =
    fields.isOrganizer === true ||
    (fields.isOrganizer === undefined &&
      record(fields.responseStatus).response === "organizer");
  const selfEmails = event.attendees
    .filter((guest) => guest.self)
    .map((guest) => guest.email);
  for (const field of ["organizer", "creator"]) {
    const party = record(fields[field]);
    if (party.self === true || (field === "organizer" && ownerOrganized)) {
      selfEmails.push(
        ...parseAddresses([party]).map((address) => address.email),
      );
    }
  }
  const guests: MailAddress[] = event.attendees.filter(
    (guest) => !guest.declined && !guest.resource,
  );
  const organizer = parseCalendarAttendee(
    fields.organizer,
    "invitation",
    event.organizerEmail,
  );
  // Outlook lists the person who sent the invitation separately from the attendees.
  // Google also provides an organizer when the guest list is omitted.
  if (
    !ownerOrganized &&
    organizer &&
    !organizer.self &&
    !organizer.declined &&
    !organizer.resource &&
    !event.attendees.some((attendee) => attendee.organizer)
  )
    guests.push(organizer);
  return {
    id: event.id,
    recurring:
      Boolean(
        fields.recurringEventId ||
          fields.seriesMasterId ||
          fields.originalStartTime,
      ) ||
      (Array.isArray(fields.recurrence)
        ? fields.recurrence.length > 0
        : !!record(fields.recurrence).pattern) ||
      fields.type === "occurrence" ||
      fields.type === "exception" ||
      fields.type === "seriesMaster",
    startsAt: meetingStart(fields.start, event),
    allDay: event.allDay,
    skip:
      event.cancelled ||
      event.ownerDeclined ||
      fields.showAs === "oof" ||
      (typeof fields.eventType === "string" &&
        NON_MEETING_EVENT_TYPES.has(fields.eventType)),
    selfEmails,
    guests: uniqueGuests(guests, [
      ...event.attendees,
      ...(organizer ? [organizer] : []),
    ]),
  };
}

export async function meetingCalendarEvents(
  botId: string,
  from: Date,
  to: Date,
  limit: number,
): Promise<MeetingCalendarEvent[]> {
  const integrations = await activeIntegrationsForBot(botId, "calendar");
  const events: MeetingCalendarEvent[] = [];
  for (const integration of integrations) {
    const page = await fetchCalendarPage(integration, {
      from,
      to,
      limit,
    }).catch(() => null);
    if (!page) continue;
    await prisma.sokoBotIntegration
      .update({
        where: { id: integration.id },
        data: { lastIngestAt: new Date() },
      })
      .catch(() => undefined);
    // The normalized events are sorted. Match raw evidence by event id, never position.
    const identities = new Map(
      page.raw.flatMap((raw) => {
        const parsed = meetingIdentity(raw);
        return parsed ? [[parsed.id, parsed] as const] : [];
      }),
    );
    for (const event of page.events) {
      const identity = identities.get(event.id);
      if (identity && (identity.skip || !identity.startsAt)) continue;
      const guests =
        identity?.guests ??
        uniqueGuests(
          parseAddresses(event.attendees, "invitation"),
          parseAddresses([event.organizer], "invitation"),
        );
      events.push({
        ...event,
        startsAt: identity?.startsAt ?? event.startsAt,
        allDay: identity?.allDay || event.allDay,
        // Scheduled prep also sends these addresses to the mail and contact searches.
        guests: guests.filter(({ email }) =>
          normalizeContactChannelValue("EMAIL", email),
        ),
        selfEmails: identity?.selfEmails ?? [],
        recurring: identity?.recurring ?? false,
      });
    }
  }
  return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
