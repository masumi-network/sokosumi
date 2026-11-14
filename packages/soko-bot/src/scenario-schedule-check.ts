import type { ScenarioCheck, SokoBotLabTurn } from "./scenario-types.js";

const MINUTE_MS = 60_000;
// Leave room for tool execution between the owner's request and persistence.
const SCHEDULE_TIMING_TOLERANCE_MS = 2 * MINUTE_MS;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function timestamp(value: unknown): number {
  return typeof value === "string" || value instanceof Date
    ? new Date(value).getTime()
    : Number.NaN;
}

/** Check the persisted outcome, not merely a call or a promise to schedule. */
export function oneTimeTaskCheck(
  turn: SokoBotLabTurn,
  expected: { taskNamePattern: string; delayMinutes: number },
): ScenarioCheck {
  const name = new RegExp(expected.taskNamePattern, "i");
  const packet = object(turn.contextPacket);
  const tasks = [
    ...(Array.isArray(packet?.tasks) ? packet.tasks : []),
    ...turn.toolCalls
      .filter(
        (call) =>
          call.capability === "get_task_status" && call.status === "COMPLETED",
      )
      .map((call) => call.result),
  ];
  const targets = new Set(
    tasks.flatMap((value) => {
      const task = object(value);
      return task &&
        typeof task.id === "string" &&
        typeof task.name === "string" &&
        name.test(task.name)
        ? [task.id]
        : [];
    }),
  );
  const calls = turn.toolCalls.filter(
    (call) =>
      call.capability === "create_schedule" ||
      call.capability === "update_schedule" ||
      call.capability === "delete_schedule",
  );
  const schedules = new Map<
    string,
    { input: Record<string, unknown>; result: Record<string, unknown> }
  >();
  for (const call of calls) {
    const input = object(call.input);
    const result = object(call.result);
    if (
      call.capability === "delete_schedule" &&
      call.status === "COMPLETED" &&
      input
    ) {
      for (const [id, saved] of schedules) {
        if (
          result?.id === id ||
          input.scheduleId === id ||
          (typeof input.scheduleName === "string" &&
            typeof saved.result.name === "string" &&
            input.scheduleName.trim().toLowerCase() ===
              saved.result.name.toLowerCase())
        ) {
          schedules.delete(id);
        }
      }
      continue;
    }
    if (
      call.status === "COMPLETED" &&
      input &&
      result &&
      typeof result.id === "string"
    )
      schedules.set(result.id, { input, result });
  }
  const saved = [...schedules.values()];
  const schedule = saved[0];
  const target = targets.size === 1 ? [...targets][0] : null;
  let valid = false;
  if (saved.length === 1 && schedule && target) {
    const { input, result } = schedule;
    const requestedAt = timestamp(input.runAt);
    const nextRunAt = timestamp(result.nextRunAt);
    const persistedAt = timestamp(result.updatedAt ?? result.createdAt);
    const delay = nextRunAt - persistedAt;
    valid =
      result.enabled === true &&
      result.runOnce === true &&
      input.taskId === target &&
      result.taskId === target &&
      !input.cronExpression &&
      requestedAt === nextRunAt &&
      Number.isFinite(delay) &&
      Math.abs(delay - expected.delayMinutes * MINUTE_MS) <=
        SCHEDULE_TIMING_TOLERANCE_MS;
  }
  return {
    label: "One persisted check for the requested Task at the requested time",
    pass: valid,
    actual: valid
      ? "one enabled, one-time Task check at the requested time"
      : targets.size !== 1
        ? "requested Task not identified unambiguously"
        : `${saved.length} saved schedule(s); Task, timing or one-time settings do not match`,
  };
}
