import { SOKO_BOT_SYSTEM_SCHEDULES } from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { buildIngestDeltaMessageForBot } from "@/services/soko-bot-ingest.service";
import { activeIntegrationsForBot } from "@/services/soko-bot-integrations.service";
import { buildSystemBeatMessage } from "@/services/soko-bot-proactive.service";

export type SokoBotLabBeat = "standup" | "weekly-wrap" | "delta";

export class SokoBotLabIngestError extends Error {}

/** Names the connection a beat cannot be built without. */
export class SokoBotLabMissingIntegrationError extends SokoBotLabIngestError {
  constructor(readonly kinds: readonly ("email" | "calendar")[]) {
    super(`Connect ${kinds.join(" and ")} to run this scenario.`);
  }
}

/**
 * What each rhythm reads from the owner's connected accounts. `weekly-wrap`
 * asks for nothing: it is built from the board and the bot's memory, which is
 * why it used to be sent to the CLI for no reason at all.
 */
const REQUIRED: Record<SokoBotLabBeat, readonly ("email" | "calendar")[]> = {
  standup: ["calendar", "email"],
  delta: ["email"],
  "weekly-wrap": [],
};

/**
 * Runs one proactive rhythm on demand, the way the cron would.
 *
 * These scenarios used to be CLI-only. The CLI's `--record` / `--replay`
 * fixtures are a convenience for working without OAuth, not a requirement:
 * the packet builders below read whatever the bot has connected, so a browser
 * can drive them exactly as well — and when a connection is missing, saying so
 * is far more use than sending someone to a terminal.
 */
export async function runSokoBotLabIngest(input: {
  userId: string;
  workspaceId: string;
  beat: SokoBotLabBeat;
}): Promise<{ turnId: string }> {
  const bot = await prisma.sokoBot.findFirst({
    where: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      archivedAt: null,
    },
    select: {
      id: true,
      workspaceId: true,
      ingestTimezone: true,
      followWholeBoard: true,
      coworker: { select: { id: true } },
    },
  });
  if (!bot) throw new SokoBotLabIngestError("Soko Bot not found");

  const missing: ("email" | "calendar")[] = [];
  for (const kind of REQUIRED[input.beat]) {
    const connected = await activeIntegrationsForBot(bot.id, kind);
    if (connected.length === 0) missing.push(kind);
  }
  if (missing.length > 0) throw new SokoBotLabMissingIntegrationError(missing);

  const message =
    input.beat === "delta"
      ? await buildIngestDeltaMessageForBot(bot.id)
      : (
          await buildSystemBeatMessage({
            bot: {
              id: bot.id,
              coworkerId: bot.coworker?.id ?? null,
              workspaceId: bot.workspaceId,
              ingestTimezone: bot.ingestTimezone,
              followWholeBoard: bot.followWholeBoard,
            },
            key: input.beat,
            prompt:
              SOKO_BOT_SYSTEM_SCHEDULES.find((s) => s.key === input.beat)
                ?.prompt ?? "Daily stand-up.",
            now: new Date(),
          })
        ).message;

  const started = await sokoBotControlPlane.startTurn({
    userId: input.userId,
    workspaceId: input.workspaceId,
    // `lab:` keeps the run out of the owner's proactive allowance, which is
    // for work the bot decided to do by itself.
    clientTurnId: `lab:ingest:${input.beat}:${Date.now()}`,
    message,
    // The source the cron would have used, so the turn is classified and
    // capability-scoped exactly as the real rhythm is.
    source: input.beat === "delta" ? "INGEST" : "SCHEDULE",
  });
  return { turnId: started.turnId };
}
