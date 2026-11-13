"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import type { SeoCommand } from "@/lib/actions/seo/types";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import type { SeoOwner } from "@/lib/seo/owner";
import { seoServiceNoRedirect } from "@/lib/services/seo.service";
import { taskScheduleService } from "@/lib/services/task-schedule.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const scheduleRevision = z.number().int().nonnegative();
/** Monitor commands go straight to the Task Schedule routes: check their shape before the id goes into a path. */
const monitorCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("monitor_state"),
      monitorId: z.uuid(),
      action: z.enum(["pause", "resume", "end"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("monitor_run_now"),
      monitorId: z.uuid(),
      expectedRevision: scheduleRevision,
    })
    .strict(),
  z
    .object({
      kind: z.literal("monitor_update"),
      monitorId: z.uuid(),
      expectedRevision: scheduleRevision,
      // Core checks the rule itself.
      rule: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);

export const mutateSeo = withSession<
  AuthenticatedRequest & { owner: SeoOwner; command: SeoCommand },
  ActionResultDto<null, ActionError>
>(async ({ owner, command }) => {
  if (
    !z
      .object({ kind: z.enum(["audit", "project"]), id: z.uuid() })
      .strict()
      .safeParse(owner).success ||
    !command ||
    (String(command.kind).startsWith("monitor_") &&
      !monitorCommandSchema.safeParse(command).success)
  ) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }
  try {
    switch (command.kind) {
      case "add_page":
        await seoServiceNoRedirect.addPage(owner, command.body);
        break;
      case "create_scope":
        await seoServiceNoRedirect.createScope(owner, command.body);
        break;
      case "update_scope":
        await seoServiceNoRedirect.updateScope(
          owner,
          command.scopeId,
          command.body,
        );
        break;
      case "import_audit":
        await seoServiceNoRedirect.importAudit(owner, command.body);
        break;
      case "record_page_change":
        await seoServiceNoRedirect.recordPageChange(owner, command.body);
        break;
      case "create_monitor":
        await seoServiceNoRedirect.createMonitor(owner, command.body);
        break;
      // A monitor is a Task Schedule: Core checks the same access and revision as on the schedule page.
      case "monitor_state":
        await taskScheduleService.changeScheduleState(
          command.monitorId,
          command.action,
        );
        break;
      case "monitor_run_now":
        await taskScheduleService.runNow(command.monitorId, {
          expectedRevision: command.expectedRevision,
        });
        break;
      case "monitor_update":
        await taskScheduleService.updateSchedule(command.monitorId, {
          expectedRevision: command.expectedRevision,
          rule: command.rule,
        });
        break;
      case "request_analysis":
        await seoServiceNoRedirect.requestAnalysis(owner, command.body);
        break;
      case "save_keyword":
        await seoServiceNoRedirect.saveKeyword(owner, command.body);
        break;
      case "save_competitor":
        await seoServiceNoRedirect.saveCompetitor(owner, command.body);
        break;
      case "create_action_task":
        await seoServiceNoRedirect.createActionTask(owner, command.body);
        break;
      case "sync_statistics":
        await seoServiceNoRedirect.syncStatistics(owner, command.body);
        break;
      default:
        return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
    }
    revalidatePath("/seo");
    if (
      command.kind === "create_action_task" ||
      command.kind === "request_analysis" ||
      command.kind === "monitor_run_now"
    )
      revalidatePath("/tasks");
    if (command.kind.includes("monitor")) revalidatePath("/schedules");
    return toActionResult(ok(null));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
