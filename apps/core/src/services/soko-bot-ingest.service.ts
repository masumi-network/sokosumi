import {
  SOKO_BOT_BRIEF_FORMAT,
  type SokoBotCalendarEvent,
  type SokoBotInboxMessage,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { sokoBotSelfStarter } from "@/lib/soko-bot/acting-user";
import {
  MAIL_TRIAGE_GUIDE,
  type TriagedMail,
  triagedMailLines,
  triageMail,
} from "@/lib/soko-bot/mail-triage";
import { SYSTEM_TURN_ROUTES } from "@/lib/soko-bot/system-routes";
import { calendarPeopleBlock } from "@/services/contacts-context.service";
import {
  SokoBotBusyError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import { sweepLeaverSokoBotIntegrations } from "@/services/soko-bot-integration-leaver.service";
import {
  activeIntegrationsForBot,
  fetchCalendarEvents,
  fetchInboxMessages,
} from "@/services/soko-bot-integrations.service";
import { autoReadBulkMail } from "@/services/soko-bot-mail-auto-read.service";
import { proactiveGate } from "@/services/soko-bot-proactive.service";

const HOUR_MS = 60 * 60 * 1_000;
/** New mail is checked at most this often per bot. */
const DELTA_INTERVAL_MS = HOUR_MS;
/** The briefing summarises this much mail; a fresh connection starts here. */
const LOOKBACK_MS = 24 * HOUR_MS;
const BRIEFING_HOUR = 7;
const MAX_MAIL_PER_PACKET = 20;
const MAX_MAIL_PER_BRIEFING = 40;
const MAX_EVENTS_PER_PACKET = 15;

export interface SokoBotIngestSyncInput {
  abortSignal: AbortSignal;
  shouldContinue: () => boolean;
}

export interface SokoBotIngestSyncResult {
  bots: number;
  briefings: number;
  deltas: number;
  skipped: number;
  deferred: number;
  failed: number;
}

interface LocalClock {
  hour: number;
  /** YYYY-MM-DD in the bot's timezone. */
  date: string;
}

export function localClock(now: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    hour: Number(get("hour")) % 24,
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** A briefing is due once per local day, from 07:00 on. */
export function briefingDue(
  now: Date,
  timeZone: string,
  lastBriefingAt: Date | null,
): boolean {
  const clock = localClock(now, timeZone);
  if (clock.hour < BRIEFING_HOUR) return false;
  if (!lastBriefingAt) return true;
  return localClock(lastBriefingAt, timeZone).date !== clock.date;
}

function fmtTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function buildIngestMessage(input: {
  kind: "briefing" | "delta";
  timeZone: string;
  mail: readonly TriagedMail[];
  events: SokoBotCalendarEvent[];
  /** Contacts lines for the people on the calendar. */
  people?: string[];
}): string {
  const lines: string[] = [];
  if (input.kind === "briefing") {
    lines.push(
      `Morning briefing time. Below is today's calendar and the mail of the last 24 hours, triaged by Jev. Give the owner a short briefing as described in your inbox skill: today's events, then the mail: urgent first with what each needs and by when, notable mail one line each, bulk only as a count. Update memory follow-ups, and propose (do not start) any delegable work. ${SOKO_BOT_BRIEF_FORMAT}`,
    );
  } else {
    lines.push(
      "New mail arrived that Jev triaged as urgent. Tell the owner briefly what each urgent one needs and by when, as described in your inbox skill, then any notable mail one line each under Notable. Leave out any that, on reading, can wait for tomorrow's briefing; if no urgent mail is left, reply exactly `Nothing new worth flagging.`",
    );
  }
  if (input.mail.some((item) => item.matchesRule))
    lines.push(
      "Some mail matches a saved rule of the owner's (listed first). For each, read it with `read_email` and do what the rule says, such as `save_email_attachment` into the folder it names, then say in one line what you filed where. Do nothing a rule does not ask for.",
    );
  lines.push(MAIL_TRIAGE_GUIDE, "");
  if (input.events.length > 0) {
    lines.push(`## Calendar (${input.timeZone})`);
    for (const event of input.events) {
      const when = event.allDay
        ? "all day"
        : `${fmtTime(event.startsAt, input.timeZone)}${event.endsAt ? `–${fmtTime(event.endsAt, input.timeZone).slice(-5)}` : ""}`;
      const who = event.attendees.length
        ? ` · with ${event.attendees.slice(0, 4).join(", ")}${event.attendees.length > 4 ? ` +${event.attendees.length - 4}` : ""}`
        : "";
      lines.push(
        `- ${when}: ${event.title}${event.location ? ` @ ${event.location}` : ""}${who} [${event.provider}:${event.id}]`,
      );
    }
    lines.push("");
  }
  if (input.people?.length) lines.push(...input.people);
  lines.push(
    ...triagedMailLines({
      timeZone: input.timeZone,
      mail: input.mail,
      limit:
        input.kind === "briefing" ? MAX_MAIL_PER_BRIEFING : MAX_MAIL_PER_PACKET,
    }),
  );
  if (input.mail.length === 0 && input.events.length === 0) {
    lines.push("Nothing new in mail or calendar.");
  }
  return lines.join("\n").trim();
}

/** The hourly delta packet for one bot right now (mail since `hours` ago); used by the lab. */
export async function buildIngestDeltaMessageForBot(
  sokoBotId: string,
  hours = 24,
): Promise<string> {
  const bot = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: sokoBotId },
    select: { ingestTimezone: true },
  });
  const since = new Date(Date.now() - hours * HOUR_MS);
  const mail: SokoBotInboxMessage[] = [];
  for (const integration of await activeIntegrationsForBot(
    sokoBotId,
    "email",
  )) {
    mail.push(
      ...(await fetchInboxMessages(integration, {
        since,
        limit: MAX_MAIL_PER_PACKET,
      })),
    );
  }
  mail.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const triage = await triageMail({
    sokoBotId,
    mail: mail.slice(0, MAX_MAIL_PER_PACKET),
    source: "lab",
  });
  triage.log.emit();
  return buildIngestMessage({
    kind: "delta",
    timeZone: bot.ingestTimezone,
    mail: triage.mail,
    events: [],
  });
}

export class SokoBotIngestSyncService {
  async syncIngest(
    input: SokoBotIngestSyncInput,
  ): Promise<SokoBotIngestSyncResult> {
    const result: SokoBotIngestSyncResult = {
      bots: 0,
      briefings: 0,
      deltas: 0,
      skipped: 0,
      deferred: 0,
      failed: 0,
    };
    // A member who left must not have their mailbox read once more.
    try {
      const disconnected = await sweepLeaverSokoBotIntegrations();
      if (disconnected > 0) {
        console.info("[soko-bot-ingest] Disconnected leavers' integrations", {
          disconnected,
        });
      }
    } catch (error) {
      console.error("Soko Bot leaver integration sweep failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const bots = await prisma.sokoBot.findMany({
      where: {
        archivedAt: null,
        integrations: { some: { status: "ACTIVE" } },
      },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        ingestTimezone: true,
        lastBriefingAt: true,
        mailAutoRead: true,
      },
    });
    for (const bot of bots) {
      if (!input.shouldContinue()) break;
      result.bots += 1;
      try {
        const outcome = await this.ingestBot(bot, input.abortSignal);
        result[outcome] += 1;
      } catch (error) {
        if (error instanceof SokoBotBusyError) {
          result.deferred += 1;
          continue;
        }
        result.failed += 1;
        console.error("Soko Bot ingest failed", {
          sokoBotId: bot.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    return result;
  }

  private async ingestBot(
    bot: {
      id: string;
      /** `null` for a shared bot. */
      userId: string | null;
      workspaceId: string;
      ingestTimezone: string;
      lastBriefingAt: Date | null;
      mailAutoRead: boolean;
    },
    abortSignal: AbortSignal,
  ): Promise<"briefings" | "deltas" | "skipped"> {
    const now = new Date();
    const hasStandup = await prisma.sokoBotSchedule.findFirst({
      where: { sokoBotId: bot.id, systemKey: "standup", enabled: true },
      select: { id: true },
    });
    // The daily stand-up carries calendar + mail; only bots without it get
    // the standalone morning briefing.
    const briefing =
      !hasStandup && briefingDue(now, bot.ingestTimezone, bot.lastBriefingAt);
    const mailIntegrations = await activeIntegrationsForBot(bot.id, "email");
    const dueMail = mailIntegrations.filter((integration) => {
      const last = cursorDate(integration.cursor, "lastIngestAt");
      return (
        briefing || !last || now.getTime() - last.getTime() >= DELTA_INTERVAL_MS
      );
    });
    if (!briefing && dueMail.length === 0) return "skipped";

    const mail: SokoBotInboxMessage[] = [];
    const cursors = new Map<string, { previous: string; newest: string }>();
    const dayAgo = new Date(now.getTime() - LOOKBACK_MS);
    for (const integration of dueMail) {
      const previous = cursorDate(integration.cursor, "newestSeenAt");
      // The briefing summarises the whole last day, mail the hourly checks
      // already looked at included; a check reads only what is new.
      const since = briefing ? dayAgo : (previous ?? dayAgo);
      let messages: SokoBotInboxMessage[];
      try {
        messages = await fetchInboxMessages(integration, {
          since,
          limit: briefing ? MAX_MAIL_PER_BRIEFING : MAX_MAIL_PER_PACKET,
        });
      } catch (error) {
        // Surfaced on the console tile by the integrations service; the
        // bot must not treat an unreadable mailbox as an empty one.
        console.error("Soko Bot ingest mail fetch failed", {
          sokoBotId: bot.id,
          provider: integration.provider.id,
          error: error instanceof Error ? error.message : "unknown",
        });
        continue;
      }
      const fresh = messages.filter(
        (message) =>
          !message.receivedAt || new Date(message.receivedAt) > since,
      );
      mail.push(...fresh);
      const floor = (previous ?? since).toISOString();
      const newest =
        [...fresh.map((message) => message.receivedAt).filter(Boolean), floor]
          .sort()
          .at(-1) ?? floor;
      cursors.set(integration.id, { previous: floor, newest });
    }
    mail.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

    let events: SokoBotCalendarEvent[] = [];
    if (briefing) {
      const dayStart = new Date(now.getTime() - 60 * 60 * 1_000);
      const dayEnd = new Date(now.getTime() + 36 * HOUR_MS);
      for (const integration of await activeIntegrationsForBot(
        bot.id,
        "calendar",
      )) {
        events.push(
          ...(await fetchCalendarEvents(integration, {
            from: dayStart,
            to: dayEnd,
            limit: MAX_EVENTS_PER_PACKET,
          })),
        );
      }
      events = events.slice(0, MAX_EVENTS_PER_PACKET);
    }
    const people = events.length
      ? await calendarPeopleBlock({
          workspaceId: bot.workspaceId,
          attendees: events.flatMap((event) => event.attendees),
          timeZone: bot.ingestTimezone,
        }).catch(() => [])
      : [];

    // `consumed` is false when the mail was fetched but not shown to the bot:
    // the check is recorded, the mail stays unseen for the next open slot.
    const stamp = async (consumed = true) => {
      for (const [id, cursor] of cursors) {
        await prisma.sokoBotIntegration.update({
          where: { id },
          data: {
            lastIngestAt: now,
            cursor: {
              newestSeenAt: consumed ? cursor.newest : cursor.previous,
              lastIngestAt: now.toISOString(),
            },
          },
        });
      }
      if (briefing && consumed) {
        await prisma.sokoBot.update({
          where: { id: bot.id },
          data: { lastBriefingAt: now },
        });
      }
    };

    if (!briefing && mail.length === 0) {
      await stamp();
      return "skipped";
    }

    // A personal bot runs for its owner; a shared bot runs for nobody.
    const starter = sokoBotSelfStarter(bot);
    const kind = briefing ? "briefing" : "delta";
    const gate = await proactiveGate(bot.id, now);
    if (!gate.ok) {
      // Logged like the events sync's withheld wake: a capped bot and a quiet
      // inbox look the same from the outside.
      console.info("[soko-bot-ingest] Wake withheld", {
        sokoBotId: bot.id,
        reason: gate.reason,
        usedToday: gate.usedToday,
        limit: gate.limit,
        mail: mail.length,
      });
      // A capped bot is not woken, but its owner's bulk mail is still read.
      if (bot.mailAutoRead && mail.length > 0) {
        const tagged = await triageMail({
          sokoBotId: bot.id,
          mail: mail.slice(0, MAX_MAIL_PER_BRIEFING),
          source: kind,
        });
        tagged.log.set({
          outcome: "withheld",
          mailAutoRead: await autoReadBulkMail(bot.id, tagged.mail),
        });
        tagged.log.emit();
      }
      await stamp(false);
      return "skipped";
    }
    // Jev tags every mail the bot is shown. Between briefings only urgent
    // mail, or mail a saved rule of the owner's asks the bot to act on, wakes
    // it; the rest, and everything when Jev is down, waits for the briefing.
    const triage = await triageMail({
      sokoBotId: bot.id,
      mail: mail.slice(
        0,
        briefing ? MAX_MAIL_PER_BRIEFING : MAX_MAIL_PER_PACKET,
      ),
      source: kind,
    });
    if (bot.mailAutoRead)
      triage.log.set({
        mailAutoRead: await autoReadBulkMail(bot.id, triage.mail),
      });
    if (
      !briefing &&
      !triage.mail.some((item) => item.tag === "URGENT" || item.matchesRule)
    ) {
      triage.log.set({ outcome: "quiet" });
      triage.log.emit();
      await stamp();
      return "skipped";
    }
    let started: Awaited<ReturnType<typeof sokoBotControlPlane.startTurn>>;
    try {
      started = await sokoBotControlPlane.startTurn({
        ...starter,
        workspaceId: bot.workspaceId,
        clientTurnId: `ingest:${kind}:${bot.id}:${now.toISOString().slice(0, 13)}`,
        message: buildIngestMessage({
          kind,
          timeZone: bot.ingestTimezone,
          mail: triage.mail,
          events,
          people,
        }),
        source: "INGEST",
        presetRoute: SYSTEM_TURN_ROUTES[`ingest:${kind}`],
      });
      // The turn's answer shows whether the bot agreed: "Nothing new worth
      // flagging." after a wake means Jev let through mail that could wait.
      triage.log.set({ outcome: "woke", turn: { id: started.turnId } });
    } catch (error) {
      triage.log.set({
        outcome: error instanceof SokoBotBusyError ? "deferred" : "failed",
      });
      throw error;
    } finally {
      triage.log.emit();
    }
    await stamp();
    if (
      started.reconciliationLeaseToken &&
      (started.status === "STARTING" || started.status === "RUNNING")
    ) {
      await sokoBotControlPlane
        .reconcileTurn(
          started.turnId,
          abortSignal,
          started.reconciliationLeaseToken,
        )
        .catch((error) => {
          console.error("Soko Bot ingest turn reconciliation failed", {
            turnId: started.turnId,
            error: error instanceof Error ? error.message : "unknown",
          });
        });
    }
    return briefing ? "briefings" : "deltas";
  }
}

function cursorDate(cursor: unknown, key: string): Date | null {
  if (!cursor || typeof cursor !== "object") return null;
  const value = (cursor as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const sokoBotIngestSyncService = new SokoBotIngestSyncService();
