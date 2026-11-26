import prisma from "@/lib/db/prisma";
import { systemScheduleRoute } from "@/lib/soko-bot/system-routes";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { buildScheduledSystemBeat } from "@/services/soko-bot-scheduled-beat.service";
import { sokoBotScheduleClientTurnId } from "@/services/soko-bot-schedules-sync.service";
import type { EvalLaneRecord } from "./eval-lanes.service";

/**
 * Starts one of the lane Cuso's rhythms (the daily run, the weekly review)
 * as its schedule does: the rhythm's own message and packet, source
 * SCHEDULE, so Core reads the turn's kind as it does in production.
 */
export async function startCusoRhythmTurn(
  lane: EvalLaneRecord,
  key: string,
  now: Date = new Date(),
): Promise<string> {
  const schedule = await prisma.sokoBotSchedule.findFirstOrThrow({
    where: { sokoBotId: lane.cusoBotId, systemKey: key },
    select: { id: true, prompt: true },
  });
  const bot = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: lane.cusoBotId },
    select: {
      id: true,
      workspaceId: true,
      ingestTimezone: true,
      followWholeBoard: true,
      userId: true,
      projectId: true,
      name: true,
      versionId: true,
    },
  });
  const beat = await buildScheduledSystemBeat(bot, key, now, schedule.prompt);
  if (beat.skip) throw new Error(`The ${key} rhythm had nothing to do`);
  const started = await sokoBotControlPlane.startTurn({
    userId: lane.userId,
    workspaceId: lane.workspaceId,
    sokoBotId: lane.cusoBotId,
    clientTurnId: sokoBotScheduleClientTurnId(schedule.id, now),
    message: beat.message,
    source: "SCHEDULE",
    presetRoute: systemScheduleRoute(key),
  });
  return started.turnId;
}
