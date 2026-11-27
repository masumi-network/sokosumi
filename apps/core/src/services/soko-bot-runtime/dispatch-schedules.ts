import type { SokoBotSchedule } from "@sokosumi/database";
import {
  sokoBotCreateScheduleInputSchema as createScheduleInputSchema,
  getSokoBotVersion,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  sokoBotScheduleIdInputSchema as scheduleIdInputSchema,
  sokoBotManageReminderInputSchema,
  sokoBotStartBackgroundRunInputSchema,
  sokoBotUpdateScheduleInputSchema as updateScheduleInputSchema,
} from "@sokosumi/soko-bot";
import { serializableTransaction } from "@/lib/db/transaction";
import { DETACHED_SOKO_BOT_NETWORK } from "@/lib/network";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import {
  type ResolvedTargetMetadata,
  resolveBotScheduleTargetForWrite,
} from "@/lib/soko-bot/target-resolver";
import { manageSokoBotReminder } from "@/services/soko-bot-proactive.service";
import {
  createSokoBotSchedule,
  deleteSokoBotSchedule,
  updateSokoBotSchedule,
} from "@/services/soko-bot-schedule.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";
import { listSchedules } from "./schedule-reads";
import {
  requireOwnScheduleScope,
  requireScheduledRunMayEnd,
  resolveBotScheduleAuthority,
  resolveRequestedScheduleCapabilities,
  runScheduleTool,
} from "./schedule-scope";
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
      return listSchedules(authorized, input.input);

    case "save_task_schedule":

    case "delete_task_schedule": {
      const taskSchedules = await import("./task-schedules");
      return input.capability === "save_task_schedule"
        ? taskSchedules.saveTaskSchedule(runtime, input, authorized)
        : taskSchedules.removeTaskSchedule(runtime, input, authorized);
    }

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
          if (authorized.turn.source === "SCHEDULE") {
            await requireScheduledRunMayEnd(
              tx,
              authorized.turn.id,
              input.capability,
              input.input,
              authorized,
            );
            await requireOwnScheduleScope(
              tx,
              authorized.turn.id,
              input.capability,
              input.input,
            );
          }
          const {
            actingUserId: userId,
            workspaceId,
            sokoBotId,
          } = authorized.turn;
          const scope = { userId, workspaceId, sokoBotId };
          let schedule:
            | Omit<SokoBotSchedule, "network">
            | Awaited<ReturnType<typeof deleteSokoBotSchedule>>;
          let resolvedTarget: ResolvedTargetMetadata | undefined;
          if (input.capability === "create_schedule") {
            const {
              stopRule,
              allowScheduledPosts,
              capabilities,
              ...scheduleInput
            } = createScheduleInputSchema.parse(input.input);
            const capabilityNames = resolveRequestedScheduleCapabilities(
              capabilities,
              authorized.grant.capabilities,
            );
            const row = await createSokoBotSchedule(
              {
                ...scope,
                ...scheduleInput,
                network: DETACHED_SOKO_BOT_NETWORK,
                capabilityNames,
                explicitCapabilities: capabilities !== undefined,
                resolveAuthority: resolveBotScheduleAuthority(
                  authorized,
                  {
                    stopRule,
                    allowScheduledPosts,
                    capabilities: capabilityNames,
                  },
                  { isUpdate: false },
                ),
              },
              tx,
            );
            const { network: _network, ...created } = row;
            schedule = created;
          } else if (input.capability === "update_schedule") {
            const {
              stopRule,
              allowScheduledPosts,
              capabilities,
              keepCapabilities: _keepCapabilities,
              ...scheduleInput
            } = updateScheduleInputSchema.parse(input.input);
            const target = await resolveBotScheduleTargetForWrite(
              authorized,
              {
                scheduleId: scheduleInput.scheduleId,
                scheduleName: scheduleInput.scheduleName,
                capability: "update_schedule",
                changesPromptOrName:
                  scheduleInput.prompt !== undefined ||
                  scheduleInput.name !== undefined,
              },
              tx,
            );
            resolvedTarget = target.resolvedTarget;
            const capabilityNames =
              capabilities !== undefined
                ? resolveRequestedScheduleCapabilities(
                    capabilities,
                    authorized.grant.capabilities,
                  )
                : undefined;
            const row = await updateSokoBotSchedule(
              {
                ...scope,
                ...scheduleInput,
                ...(target.scheduleId ? { scheduleId: target.scheduleId } : {}),
                ...(capabilityNames !== undefined
                  ? { capabilityNames, explicitCapabilities: true }
                  : {}),
                editorCapabilities: authorized.grant.capabilities,
                // Cuso's rhythms are the work he was hired for: what
                // the owner asks for becomes a schedule of its own.
                keepBuiltInRhythms:
                  getSokoBotVersion(authorized.turn.versionId).profile ===
                  "cmo",
                resolveAuthority: resolveBotScheduleAuthority(
                  authorized,
                  {
                    stopRule,
                    allowScheduledPosts,
                    capabilities: capabilityNames,
                  },
                  { isUpdate: true },
                ),
              },
              tx,
            );
            const { network: _network, ...updated } = row;
            schedule = updated;
          } else {
            const deleteRef = scheduleIdInputSchema.parse(input.input);
            const target = await resolveBotScheduleTargetForWrite(
              authorized,
              {
                scheduleId: deleteRef.scheduleId,
                scheduleName: deleteRef.scheduleName,
                capability: "delete_schedule",
              },
              tx,
            );
            resolvedTarget = target.resolvedTarget;
            schedule = await deleteSokoBotSchedule(
              scope.userId,
              {
                ...scope,
                ...deleteRef,
                ...(target.scheduleId ? { scheduleId: target.scheduleId } : {}),
              },
              tx,
            );
          }
          const baseResult =
            input.capability === "delete_schedule"
              ? { ...schedule, deleted: true }
              : schedule;
          const result = resolvedTarget
            ? { ...baseResult, resolvedTarget }
            : baseResult;
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
