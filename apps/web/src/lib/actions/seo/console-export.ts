"use server";

import type {
  SeoConsoleExportInput,
  SeoConsoleExportSummary,
} from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import type { SeoOwner } from "@/lib/seo/owner";
import { seoServiceNoRedirect } from "@/lib/services/seo.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

export const readOrImportConsoleExport = withSession<
  AuthenticatedRequest & {
    owner: SeoOwner;
    taskId: string;
    userId: string;
    organizationId: string | null;
    body?: SeoConsoleExportInput;
  },
  ActionResultDto<SeoConsoleExportSummary[], number>
>(async ({ session, owner, taskId, userId, organizationId, body }) => {
  if (
    userId !== session.user.id ||
    organizationId !== (session.session.activeOrganizationId ?? null)
  ) {
    return toActionResult(err(403));
  }
  if (
    !z
      .object({ kind: z.enum(["audit", "project"]), id: z.uuid() })
      .safeParse(owner).success ||
    !z.uuid().safeParse(taskId).success
  ) {
    return toActionResult(err(422));
  }
  try {
    return toActionResult(
      ok(await seoServiceNoRedirect.consoleExports(owner, taskId, body)),
    );
  } catch (error) {
    return toActionResult(
      err(error instanceof CoreApiRequestError ? (error.status ?? 500) : 500),
    );
  }
});
