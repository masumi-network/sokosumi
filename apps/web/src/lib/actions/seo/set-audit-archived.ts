"use server";

import { err } from "neverthrow";
import { revalidatePath } from "next/cache";
import { RedirectType, redirect } from "next/navigation";
import { z } from "zod";
import { seoAuditHref, seoIndexHref } from "@/app/seo/seo-href";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { revalidateTaskMutationRoutes } from "@/lib/actions/task/task-mutation";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import { seoServiceNoRedirect } from "@/lib/services/seo.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const archiveAuditInput = z.object({
  auditId: z.uuid(),
  projectId: z.uuid().nullable(),
  archived: z.boolean(),
});

export const setSeoAuditArchivedAction = withSession<
  AuthenticatedRequest & z.infer<typeof archiveAuditInput>,
  ActionResultDto<never, ActionError>
>(async ({ auditId, projectId, archived }) => {
  if (!archiveAuditInput.safeParse({ auditId, projectId, archived }).success)
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  try {
    await seoServiceNoRedirect.setAuditArchived(auditId, archived);
  } catch (error) {
    return toActionResult(
      err({
        ...toCoreApiActionError(error),
        ...(error instanceof CoreApiRequestError
          ? { status: error.status }
          : {}),
      }),
    );
  }
  revalidatePath("/seo");
  revalidateTaskMutationRoutes();
  redirect(
    archived ? seoIndexHref(projectId) : seoAuditHref(auditId, projectId),
    RedirectType.replace,
  );
});
