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
