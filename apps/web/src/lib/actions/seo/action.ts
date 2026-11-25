"use server";

import type { RequestProjectSeoAnalysisRequest } from "@sokosumi/core-client";
import { seoFullAuditPrice } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { type SeoCommand, seoReviewIdentity } from "@/lib/actions/seo/types";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import type { SeoOwner } from "@/lib/seo/owner";
import { seoServiceNoRedirect } from "@/lib/services/seo.service";
import { taskScheduleService } from "@/lib/services/task-schedule.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

/** The price terms never pass through the browser: a new full audit approves them here. A cap the browser sends goes on, so Core refuses it as a stale price. */
function withFullAuditPrice(
  analysis: RequestProjectSeoAnalysisRequest,
): RequestProjectSeoAnalysisRequest {
  return analysis.kind === "audit_full"
    ? {
        ...analysis,
        fullAuditPrice: seoFullAuditPrice(analysis.fullAuditPrice?.maxCredits),
      }
    : analysis;
}

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
      allowLimitedAudit: z.literal(true).optional(),
      searchConsolePropertyId: z.string().min(1).max(500).optional(),
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
  AuthenticatedRequest & {
    owner: SeoOwner;
    command: SeoCommand;
    briefViewer?: {
      userId: string;
      organizationId: string | null;
      sessionId?: string;
    };
  },
  ActionResultDto<null, ActionError>
>(async ({ owner, command, briefViewer, session }) => {
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
  const reviewIdentity = seoReviewIdentity(command);
  if (
    reviewIdentity &&
    (!briefViewer ||
      briefViewer.userId !== session.user.id ||
      (reviewIdentity === "session" && !briefViewer.sessionId) ||
      (briefViewer.sessionId !== undefined &&
        briefViewer.sessionId !== session.session.id) ||
      briefViewer.organizationId !==
        (session.session.activeOrganizationId ?? null))
  ) {
    return toActionResult(
      err({
        code: CommonErrorCode.UNAUTHORIZED,
        status: 409,
        kind: "seo_viewer_changed",
      }),
    );
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
      case "save_brand_terms":
        await seoServiceNoRedirect.saveBrandTerms(owner, command.body);
        break;
      case "create_monitor":
        await seoServiceNoRedirect.createMonitor(owner, {
          ...command.body,
          analysis: withFullAuditPrice(command.body.analysis),
        });
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
          ...(command.allowLimitedAudit && { allowLimitedAudit: true }),
          ...(command.searchConsolePropertyId && {
            searchConsolePropertyId: command.searchConsolePropertyId,
          }),
        });
        break;
      case "monitor_update":
        await taskScheduleService.updateSchedule(command.monitorId, {
          expectedRevision: command.expectedRevision,
          rule: command.rule,
        });
        break;
      case "request_analysis":
        await seoServiceNoRedirect.requestAnalysis(
          owner,
          withFullAuditPrice(command.body),
        );
        break;
      case "save_keyword":
        await seoServiceNoRedirect.saveKeyword(owner, command.body);
        break;
      case "save_competitor":
        await seoServiceNoRedirect.saveCompetitor(owner, command.body);
        break;
      case "acknowledge_review":
        await seoServiceNoRedirect.acknowledgeReview(owner, command.body);
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
    const refusal = toCoreApiActionError(error);
    if (
      command.kind === "request_analysis" ||
      command.kind === "create_monitor" ||
      command.kind === "monitor_run_now"
    )
      return toActionResult(
        err({
          code: refusal.code,
          kind: refusal.kind,
          ...(error instanceof CoreApiRequestError && { status: error.status }),
        }),
      );
    return toActionResult(err(refusal));
  }
});
