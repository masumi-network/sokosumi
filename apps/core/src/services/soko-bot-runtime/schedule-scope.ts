import { type Prisma } from "@sokosumi/database";
import {
  type SokoBotCapability,
  sokoBotScheduleIdInputSchema as scheduleIdInputSchema,
  sokoBotUpdateScheduleInputSchema as updateScheduleInputSchema,
} from "@sokosumi/soko-bot";
import { OWN_SCHEDULE_CAPABILITIES } from "@/lib/soko-bot/system-routes";
import {
  SokoBotScheduleNotFoundError,
  SokoBotScheduleValidationError,
} from "@/services/soko-bot-schedule.service";
import { SokoBotRuntimeValidationError } from "../soko-bot-runtime.service";

/** Schedule tools never need approval; their domain errors become tool errors the model can read. */
export async function runScheduleTool<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof SokoBotScheduleNotFoundError ||
      error instanceof SokoBotScheduleValidationError
    ) {
      throw new SokoBotRuntimeValidationError(error.message);
    }
    throw error;
  }
}

/**
 * Words in a brief that ask the run to end its own schedule ("delete this
 * schedule once Mira is done", "stop the check-ins when it ships"), in
 * English and German. A brief without them never ends its schedule, and a
 * negated one ("never delete this schedule", "lösche den Zeitplan nicht")
 * forbids it rather than asking (Neon round 6).
 */
const ASKS_TO_END =
  /\b(delete|remove|stop|cancel|end|turn off|disable|pause|lösch\w*|entfern\w*|beend\w*|stopp\w*)\b[^.!?\n]{0,60}\b(this|the|that|it|diese[nrs]?|den|die|das)?\s*(schedule|check-?ins?|checks?|reminders?|follow-?ups?|watch|zeitplan|erinnerung\w*)\b/gi;
/** Negation shortly before the verb, in the same sentence. */
const NEGATED_BEFORE =
  /\b(never|not|don'?t|doesn'?t|do not|must not|mustn'?t|nie|niemals|nicht|kein\w*)\b[^.!?\n]{0,20}$/i;
/** German negates after the object: "lösche diesen Zeitplan nicht". */
const NEGATED_AFTER = /^[^.!?\n]{0,15}\b(nicht|nie|niemals)\b/i;
const NEGATION_INSIDE = /\b(never|not|don'?t|nicht|nie|niemals)\b/i;

export function briefAsksToEnd(prompt: string): boolean {
  for (const match of prompt.matchAll(ASKS_TO_END)) {
    const before = prompt.slice(Math.max(0, match.index - 40), match.index);
    const after = prompt.slice(match.index + match[0].length);
    if (
      !NEGATED_BEFORE.test(before) &&
      !NEGATION_INSIDE.test(match[0]) &&
      !NEGATED_AFTER.test(after)
    )
      return true;
  }
  return false;
}

/**
 * A scheduled run deletes or switches off a schedule only when it is its own
 * and its brief, the owner's words, asks for that. A weekly-report run once
 * read the board and deleted its own schedule on a guess (Codex round 13).
 */
export async function requireScheduledRunMayEnd(
  tx: Prisma.TransactionClient,
  turnId: string,
  capability: SokoBotCapability,
  rawInput: unknown,
) {
  const ends =
    capability === "delete_schedule" ||
    (capability === "update_schedule" &&
      updateScheduleInputSchema.safeParse(rawInput).data?.enabled === false);
  if (!ends) return;
  const refusal =
    "A scheduled run doesn't delete or switch off schedules unless its own brief says to. Report what you found and let the owner decide.";
  const run = await tx.sokoBotScheduleRun.findUnique({
    where: { turnId },
    select: { schedule: { select: { id: true, name: true, prompt: true } } },
  });
  if (!run) throw new SokoBotRuntimeValidationError(refusal);
  const ref = (
    capability === "update_schedule"
      ? updateScheduleInputSchema
      : scheduleIdInputSchema
  ).safeParse(rawInput);
  const own =
    ref.success &&
    (ref.data.scheduleId
      ? ref.data.scheduleId === run.schedule.id
      : ref.data.scheduleName?.trim().toLowerCase() ===
        run.schedule.name.trim().toLowerCase());
  if (!own || !briefAsksToEnd(run.schedule.prompt))
    throw new SokoBotRuntimeValidationError(refusal);
}

/**
 * A schedule run gets update/delete for its own schedule even when the turn
 * that wrote the schedule had no schedule tools (an owner-made one). Those
 * extra tools reach that schedule only.
 */
export async function requireOwnScheduleScope(
  tx: Prisma.TransactionClient,
  turnId: string,
  capability: SokoBotCapability,
  rawInput: unknown,
) {
  if (
    !(OWN_SCHEDULE_CAPABILITIES as readonly SokoBotCapability[]).includes(
      capability,
    )
  )
    return;
  const run = await tx.sokoBotScheduleRun.findUnique({
    where: { turnId },
    select: {
      schedule: { select: { id: true, name: true, capabilityNames: true } },
    },
  });
  if (!run || run.schedule.capabilityNames.includes(capability)) return;
  const ref = (
    capability === "update_schedule"
      ? updateScheduleInputSchema
      : scheduleIdInputSchema
  ).safeParse(rawInput);
  const own =
    ref.success &&
    (ref.data.scheduleId
      ? ref.data.scheduleId === run.schedule.id
      : ref.data.scheduleName?.trim().toLowerCase() ===
        run.schedule.name.trim().toLowerCase());
  if (!own)
    throw new SokoBotRuntimeValidationError(
      `This run may only change its own schedule "${run.schedule.name}" (${run.schedule.id})`,
    );
}
