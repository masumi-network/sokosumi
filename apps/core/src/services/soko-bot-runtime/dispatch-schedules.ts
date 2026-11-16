import {
  sokoBotCreateScheduleInputSchema as createScheduleInputSchema,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  sokoBotScheduleIdInputSchema as scheduleIdInputSchema,
  sokoBotManageReminderInputSchema,
  sokoBotStartBackgroundRunInputSchema,
  sokoBotUpdateScheduleInputSchema as updateScheduleInputSchema,
} from "@sokosumi/soko-bot";
import { serializableTransaction } from "@/lib/db/transaction";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { manageSokoBotReminder } from "@/services/soko-bot-proactive.service";
import {
  createSokoBotSchedule,
  deleteSokoBotSchedule,
  listSokoBotSchedules,
  updateSokoBotSchedule,
} from "@/services/soko-bot-schedule.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";
import { requireOwnScheduleScope, runScheduleTool } from "./schedule-scope";

export async function dispatchSchedulesTools(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  switch (input.capability) {
    case "wait_for": {
      const watches = await import("@/services/soko-bot-watches.service");
      return watches.registerWatch(
        authorized,
        SOKO_BOT_TOOL_INPUT_SCHEMAS.wait_for.parse(input.input),
      );
    }

    case "start_background_run":

    case "list_background_runs":

    case "stop_background_run": {
      const runs = await import("@/services/soko-bot-background-runs.service");
      if (input.capability === "list_background_runs")
        return runs.listBackgroundRuns(authorized);
      if (input.capability === "stop_background_run")
        return runs.stopBackgroundRun(
          authorized,
          SOKO_BOT_TOOL_INPUT_SCHEMAS.stop_background_run.parse(input.input)
            .runId,
        );
      return runs.startBackgroundRun(
        authorized,
        sokoBotStartBackgroundRunInputSchema.parse(input.input),
      );
    }

    case "manage_reminder": {
      const parsed = sokoBotManageReminderInputSchema.parse(input.input);
      return serializableTransaction(async (tx) => {
        await runtime.requireMutationAuthority(
          tx,
          authorized,
          false,
          "manage_reminder",
        );
        const reminder = await manageSokoBotReminder(tx, {
          sokoBotId: authorized.turn.sokoBotId,
          ...parsed,
        });
        if (!reminder.applied || !reminder.id)
          throw new SokoBotRuntimeValidationError(
            "Reminder changed or action is invalid; read it again",
          );
        await commitActionReceipt(tx, {
          turnId: authorized.turn.id,
          toolCallId: input.toolCallId,
          actorBotId: authorized.turn.sokoBotId,
          targetId: reminder.id,
          result: persistedToolResult(reminder),
        });
        return reminder;
      }, "Reminder changed concurrently");
    }

    case "list_schedules":
      return listSokoBotSchedules(authorized.turn.sokoBotId);

    case "create_schedule":

    case "update_schedule":

    case "delete_schedule":
      return runScheduleTool(() =>
        serializableTransaction(async (tx) => {
          await runtime.requireMutationAuthority(
            tx,
            authorized,
            false,
            input.capability,
          );
          if (authorized.turn.source === "SCHEDULE")
            await requireOwnScheduleScope(
              tx,
              authorized.turn.id,
              input.capability,
              input.input,
            );
          const {
            actingUserId: userId,
            workspaceId,
            sokoBotId,
          } = authorized.turn;
          const scope = { userId, workspaceId, sokoBotId };
          const schedule =
            input.capability === "create_schedule"
              ? await createSokoBotSchedule(
                  {
                    ...scope,
                    ...createScheduleInputSchema.parse(input.input),
                    capabilityNames: authorized.grant.capabilities,
                  },
                  tx,
                )
              : input.capability === "update_schedule"
                ? await updateSokoBotSchedule(
                    {
                      ...scope,
                      ...updateScheduleInputSchema.parse(input.input),
                    },
                    tx,
                  )
                : await deleteSokoBotSchedule(
                    scope.userId,
                    { ...scope, ...scheduleIdInputSchema.parse(input.input) },
                    tx,
                  );
          const result =
            input.capability === "delete_schedule"
              ? { ...schedule, deleted: true }
              : schedule;
          await commitActionReceipt(tx, {
            turnId: authorized.turn.id,
            toolCallId: input.toolCallId,
            actorBotId: authorized.turn.sokoBotId,
            targetId: schedule.id,
            result: persistedToolResult(result),
          });
          return result;
        }, "Schedule action collided with another operation"),
      );
  }
}
