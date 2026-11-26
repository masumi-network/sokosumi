import {
  getSokoBotVersion,
  SOKO_BOT_CMO_RHYTHMS,
  SOKO_BOT_SYSTEM_SCHEDULES,
  sokoBotSystemSchedulePrompt,
} from "@sokosumi/soko-bot";
import { isSharedSokoBot } from "@/helpers/soko-bot-kind";
import { databaseNow } from "@/lib/db/database-now";
import {
  buildSystemBeatMessage,
  isIdleSokoBot,
} from "@/services/soko-bot-proactive.service";

export async function buildScheduledSystemBeat(
  bot: Parameters<typeof buildSystemBeatMessage>[0]["bot"] & {
    versionId: string | null;
  },
  key: string,
  scheduledFor: Date,
  schedulePrompt: string,
) {
  // A CMO bot's rhythms carry one prompt, its own: a dream there
  // must not read like an assistant's with its morning stand-up.
  const cmo = getSokoBotVersion(bot.versionId).profile === "cmo";
  // Cuso's rhythms run its paid marketing work; only an assistant rests.
  if (!cmo && (await isIdleSokoBot(bot.id, scheduledFor)))
    return { message: "", nudgeKeys: [], skip: true };
  const rhythm = SOKO_BOT_SYSTEM_SCHEDULES.find(
    (candidate) => candidate.key === key,
  );
  const cmoRhythm = cmo
    ? SOKO_BOT_CMO_RHYTHMS.find((candidate) => candidate.key === key)
    : undefined;
  // Registry prompt wins so wording changes ship without a migration.
  const prompt =
    key === "meeting-prep"
      ? rhythm?.prompt
      : cmo
        ? (cmoRhythm?.prompt ?? schedulePrompt)
        : ((rhythm &&
            sokoBotSystemSchedulePrompt(rhythm, isSharedSokoBot(bot))) ??
          schedulePrompt);
  if (!prompt && key === "meeting-prep")
    return { message: "", nudgeKeys: [], skip: true };
  return buildSystemBeatMessage({
    bot,
    key,
    prompt: prompt ?? schedulePrompt,
    // Meeting prep reads the window after its own half-hour slot,
    // so a late or retried run briefs the same meetings, once.
    now: key === "meeting-prep" ? scheduledFor : await databaseNow(),
  });
}
