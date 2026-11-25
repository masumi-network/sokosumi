"use server";

import type {
  CreateSeoAuditRequest,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { seoFirstPageCheckBody } from "@/app/seo/components/seo-first-check-model";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { seoServiceNoRedirect } from "@/lib/services/seo.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

export const createSeoAuditAction = withSession<
  AuthenticatedRequest & { body: CreateSeoAuditRequest },
  ActionResultDto<ProjectSeoWorkspace, ActionError>
>(async ({ body }) => {
  try {
    const audit = await seoServiceNoRedirect.createAudit(body);
    const check = audit.auditId
      ? seoFirstPageCheckBody(audit, crypto.randomUUID())
      : null;
    if (audit.auditId && check) {
      try {
        await seoServiceNoRedirect.requestAnalysis(
          { kind: "audit", id: audit.auditId },
          check,
        );
      } catch {
        // The audit exists: its setup card offers the workspace's check action when this one did not start.
      }
      // Core can save the check's Task and still fail the response: refresh Tasks after every attempt.
      revalidatePath("/tasks");
    }
    revalidatePath("/seo");
    return toActionResult(ok(audit));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
