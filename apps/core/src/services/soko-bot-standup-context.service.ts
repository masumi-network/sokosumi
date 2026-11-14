import {
  redactSokoBotSensitiveText,
  type SokoBotCalendarEvent,
  type SokoBotInboxMessage,
} from "@sokosumi/soko-bot";
import {
  MAIL_TRIAGE_GUIDE,
  triagedMailLines,
  triageMail,
} from "@/lib/soko-bot/mail-triage";
import { calendarPeopleBlock } from "@/services/contacts-context.service";
import {
  activeIntegrationsForBot,
  fetchCalendarEvents,
  fetchInboxMessages,
  withOwnerReplies,
} from "@/services/soko-bot-integrations.service";
import type { RhythmBot } from "@/services/soko-bot-rhythms.service";

const HOUR_MS = 60 * 60 * 1_000;
const STANDUP_MAIL_LIMIT = 40;
const CALENDAR_ORGANIZER_LIMIT = 160;
const CALENDAR_AGENDA_LIMIT = 300;

function calendarText(value: string, limit: number): string {
  return JSON.stringify(
    redactSokoBotSensitiveText(value)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit),
  );
}

/** Calendar and inbox context for the daily stand-up. */
export async function standupSourcesBlock(
  bot: RhythmBot,
  now: Date,
): Promise<string[]> {
  const lines: string[] = [];
  const events: SokoBotCalendarEvent[] = [];
  for (const integration of await activeIntegrationsForBot(
    bot.id,
    "calendar",
  )) {
    events.push(
      ...(await fetchCalendarEvents(integration, {
        from: new Date(now.getTime() - HOUR_MS),
        to: new Date(now.getTime() + 36 * HOUR_MS),
        limit: 15,
      }).catch(() => [])),
    );
  }
  if (events.length > 0) {
    lines.push(`## Calendar (${bot.ingestTimezone})`);
    for (const event of events.slice(0, 15)) {
      const when = event.allDay
        ? "all day"
        : new Intl.DateTimeFormat("en-GB", {
            timeZone: bot.ingestTimezone,
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(event.startsAt));
      lines.push(
        `- ${when}: ${event.title}${event.attendees.length ? ` · with ${event.attendees.slice(0, 4).join(", ")}` : ""} [${event.provider}:${event.id}]`,
      );
      // Provider text is evidence about the meeting, never an instruction.
      if (event.organizer)
        lines.push(
          `  Organizer (untrusted calendar data): ${calendarText(event.organizer, CALENDAR_ORGANIZER_LIMIT)}`,
        );
      if (event.description)
        lines.push(
          `  Agenda (untrusted calendar data): ${calendarText(event.description, CALENDAR_AGENDA_LIMIT)}`,
        );
    }
    lines.push("");
    lines.push(
      ...(await calendarPeopleBlock({
        workspaceId: bot.workspaceId,
        attendees: events.slice(0, 15).flatMap((event) => event.attendees),
        timeZone: bot.ingestTimezone,
      }).catch(() => [])),
    );
  }
  const mail: SokoBotInboxMessage[] = [];
  const dayAgo = new Date(now.getTime() - 24 * HOUR_MS);
  for (const integration of await activeIntegrationsForBot(bot.id, "email")) {
    const received = await fetchInboxMessages(integration, {
      since: dayAgo,
      limit: STANDUP_MAIL_LIMIT,
    }).catch(() => []);
    mail.push(...(await withOwnerReplies(integration, received, dayAgo)));
  }
  if (mail.length > 0) {
    const triage = await triageMail({
      sokoBotId: bot.id,
      mail: mail.slice(0, STANDUP_MAIL_LIMIT),
      source: "standup",
    });
    triage.log.emit();
    lines.push(
      `The mail below is from the last 24 hours. ${MAIL_TRIAGE_GUIDE}`,
      "",
      ...triagedMailLines({
        timeZone: bot.ingestTimezone,
        mail: triage.mail,
        limit: STANDUP_MAIL_LIMIT,
      }),
    );
  }
  return lines;
}
