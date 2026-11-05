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
import { seoServiceNoRedirect } from "@/lib/services/seo.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

export const mutateProjectSeo = withSession<
  AuthenticatedRequest & { projectId: string; command: SeoCommand },
  ActionResultDto<null, ActionError>
>(async ({ projectId, command }) => {
  if (!z.uuid().safeParse(projectId).success || !command) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }
  try {
    switch (command.kind) {
      case "add_page":
        await seoServiceNoRedirect.addPage(projectId, command.body);
        break;
      case "create_scope":
        await seoServiceNoRedirect.createScope(projectId, command.body);
        break;
      case "update_scope":
        await seoServiceNoRedirect.updateScope(
          projectId,
          command.scopeId,
          command.body,
        );
        break;
      case "import_audit":
        await seoServiceNoRedirect.importAudit(projectId, command.body);
        break;
      case "record_page_change":
        await seoServiceNoRedirect.recordPageChange(projectId, command.body);
        break;
      case "create_monitor":
        await seoServiceNoRedirect.createMonitor(projectId, command.body);
        break;
      case "request_analysis":
        await seoServiceNoRedirect.requestAnalysis(projectId, command.body);
        break;
      case "save_keyword":
        await seoServiceNoRedirect.saveKeyword(projectId, command.body);
        break;
      case "save_competitor":
        await seoServiceNoRedirect.saveCompetitor(projectId, command.body);
        break;
      case "create_action_task":
        await seoServiceNoRedirect.createActionTask(projectId, command.body);
        break;
      case "sync_statistics":
        await seoServiceNoRedirect.syncStatistics(projectId, command.body);
        break;
      default:
        return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
    }
    revalidatePath("/seo");
    if (
      command.kind === "create_action_task" ||
      command.kind === "request_analysis"
    )
      revalidatePath("/tasks");
    if (command.kind === "create_monitor") revalidatePath("/schedules");
    return toActionResult(ok(null));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
