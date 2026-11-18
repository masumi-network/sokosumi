"use server";

import type {
  SaveSeoAuditBriefRequest,
  SeoAuditBrief,
} from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import type { SeoOwner } from "@/lib/seo/owner";
import { seoBriefService } from "@/lib/services/seo-brief.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const ownerSchema = z.strictObject({
  kind: z.enum(["audit", "project"]),
  id: z.uuid(),
});

export const saveSeoBriefAction = withSession<
  AuthenticatedRequest & {
    owner: SeoOwner;
    viewerId: string;
    organizationId: string | null;
    body: SaveSeoAuditBriefRequest;
  },
  ActionResultDto<SeoAuditBrief, ActionError>
>(async ({ session, viewerId, organizationId, owner, body }) => {
  if (!ownerSchema.safeParse(owner).success)
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  if (
    viewerId !== session.user.id ||
    organizationId !== (session.session.activeOrganizationId ?? null)
  )
    return toActionResult(
      err({
        code: CommonErrorCode.UNAUTHORIZED,
        status: 409,
        kind: "seo_viewer_changed",
      }),
    );
  try {
    return toActionResult(ok(await seoBriefService.save(owner, body)));
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
});
