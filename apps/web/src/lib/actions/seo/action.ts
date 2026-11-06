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
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

export const mutateSeo = withSession<
  AuthenticatedRequest & { owner: SeoOwner; command: SeoCommand },
  ActionResultDto<null, ActionError>
>(async ({ owner, command }) => {
  if (
    !z
      .object({ kind: z.enum(["audit", "project"]), id: z.uuid() })
      .strict()
      .safeParse(owner).success ||
    !command
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
      command.kind === "request_analysis"
    )
      revalidatePath("/tasks");
    if (command.kind === "create_monitor") revalidatePath("/schedules");
    return toActionResult(ok(null));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
