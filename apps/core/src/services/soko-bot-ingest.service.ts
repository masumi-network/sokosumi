import type {
  SokoBotCalendarEvent,
  SokoBotInboxMessage,
} from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import {
  SokoBotBusyError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import {
  activeIntegrationsForBot,
  fetchCalendarEvents,
  fetchInboxMessages,
} from "@/services/soko-bot-integrations.service";

const HOUR_MS = 60 * 60 * 1_000;
/** New mail is checked at most this often per bot. */
const DELTA_INTERVAL_MS = HOUR_MS;
/** First ingest of a fresh connection looks this far back. */
const INITIAL_LOOKBACK_MS = 24 * HOUR_MS;
const BRIEFING_HOUR = 7;
const MAX_MAIL_PER_PACKET = 20;
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
  mail: SokoBotInboxMessage[];
  events: SokoBotCalendarEvent[];
}): string {
  const lines: string[] = [];
  if (input.kind === "briefing") {
    lines.push(
      "Morning briefing time. Below is today's calendar and the mail that arrived since yesterday. Give the owner a short briefing as described in your inbox skill, update memory follow-ups, and propose (do not start) any delegable work.",
    );
  } else {
    lines.push(
      "New mail arrived since your last look. Flag only what matters as described in your inbox skill; if nothing does, reply exactly `Nothing new worth flagging.`",
    );
  }
  lines.push("");
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
  if (input.mail.length > 0) {
    lines.push(
      `## Mail (${input.mail.length}${input.mail.length >= MAX_MAIL_PER_PACKET ? "+" : ""})`,
    );
    for (const message of input.mail) {
      lines.push(
        `- ${fmtTime(message.receivedAt, input.timeZone)} · ${message.unread ? "unread" : "read"} · from ${message.from} · **${message.subject || "(no subject)"}** — ${message.snippet.replace(/\s+/g, " ").slice(0, 160)} [${message.provider}:${message.id}]`,
      );
    }
    lines.push("");
  }
  if (input.mail.length === 0 && input.events.length === 0) {
    lines.push("Nothing new in mail or calendar.");
  }
  return lines.join("\n").trim();
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
      userId: string;
      workspaceId: string;
      ingestTimezone: string;
      lastBriefingAt: Date | null;
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
    const cursors = new Map<string, string>();
    for (const integration of dueMail) {
      const since =
        cursorDate(integration.cursor, "newestSeenAt") ??
        new Date(now.getTime() - INITIAL_LOOKBACK_MS);
      const messages = await fetchInboxMessages(integration, {
        since,
        limit: MAX_MAIL_PER_PACKET,
      });
      const fresh = messages.filter(
        (message) =>
          !message.receivedAt || new Date(message.receivedAt) > since,
      );
      mail.push(...fresh);
      const newest = fresh
        .map((message) => message.receivedAt)
        .filter(Boolean)
        .sort()
        .at(-1);
      cursors.set(integration.id, newest ?? since.toISOString());
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

    const stamp = async () => {
      for (const [id, newestSeenAt] of cursors) {
        await prisma.sokoBotIntegration.update({
          where: { id },
          data: {
            lastIngestAt: now,
            cursor: { newestSeenAt, lastIngestAt: now.toISOString() },
          },
        });
      }
      if (briefing) {
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

    const kind = briefing ? "briefing" : "delta";
    const started = await sokoBotControlPlane.startTurn({
      userId: bot.userId,
      workspaceId: bot.workspaceId,
      clientTurnId: `ingest:${kind}:${bot.id}:${now.toISOString().slice(0, 13)}`,
      message: buildIngestMessage({
        kind,
        timeZone: bot.ingestTimezone,
        mail: mail.slice(0, MAX_MAIL_PER_PACKET),
        events,
      }),
      source: "INGEST",
    });
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
