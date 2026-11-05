import { isCmoScheduleKey } from "@sokosumi/soko-bot";

/**
 * The person a Soko Bot schedule, turn or pending decision acts for: its
 * Requester, the member who asked (ADR 0057). A record the bot started on its
 * own has no Requester, and a personal Soko Bot then acts for its owner, as
 * every personal bot always has. A shared Soko Bot then acts for nobody: null.
 */
export function sokoBotActingUserId(record: {
  requestedByUserId: string | null;
  sokoBot: { userId: string };
}): string;
export function sokoBotActingUserId(record: {
  requestedByUserId: string | null;
  sokoBot: { userId: string | null };
}): string | null;
export function sokoBotActingUserId(record: {
  requestedByUserId: string | null;
  sokoBot: { userId: string | null };
}): string | null {
  return record.requestedByUserId ?? record.sokoBot.userId;
}

/**
 * The person a schedule's run acts for. A shared Soko Bot's schedule runs on
 * its own: its Requester is a record, and a schedule another member edited
 * must never act for them. Cuso's own rhythms are the exception: they are the
 * work he was hired for, and run as the member who hired him, their Requester
 * since creation (ADR 0061).
 */
export function sokoBotScheduleActingUserId(schedule: {
  requestedByUserId: string | null;
  systemKey: string | null;
  sokoBot: { userId: string | null };
}): string | null {
  return schedule.sokoBot.userId === null &&
    !isCmoScheduleKey(schedule.systemKey)
    ? null
    : sokoBotActingUserId(schedule);
}

/**
 * Matches the schedules whose runs act for `actingUserId`. A run that acts
 * for nobody adds no condition: only a shared bot's runs do, and the caller
 * pins the schedule to the bot it already resolved.
 */
export function sokoBotScheduleActingUserWhere(actingUserId: string | null) {
  return actingUserId === null ? {} : { requestedByUserId: actingUserId };
}

/**
 * The `startTurn` fields for a turn the bot starts itself. A personal bot
 * acts for its owner and finds itself through them; a shared bot acts for
 * nobody, so it names itself.
 */
export function sokoBotSelfStarter(bot: {
  id: string;
  userId: string | null;
}): { userId: string } | { userId: null; sokoBotId: string } {
  return bot.userId === null
    ? { userId: null, sokoBotId: bot.id }
    : { userId: bot.userId };
}
