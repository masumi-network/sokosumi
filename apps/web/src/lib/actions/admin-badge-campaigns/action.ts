"use server";

import { AnnouncedFeature, type BadgeCampaign } from "@sokosumi/core-client";
import type { Session } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { coreClient, toCoreApiActionError } from "@/lib/clients/core.client";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const ADMIN_BADGE_CAMPAIGNS_PATH = "/admin/badge-campaigns";

const campaignWindowSchema = z.object({
  startsAt: z.iso.datetime().transform((value) => new Date(value)),
  endsAt: z.iso.datetime().transform((value) => new Date(value)),
});

const createSchema = campaignWindowSchema.extend({
  feature: z.enum(AnnouncedFeature),
});

const updateSchema = campaignWindowSchema.extend({
  id: z.string().min(1),
});

const campaignIdSchema = z.object({ id: z.string().min(1) });

function toAdminActionError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      message: "Admin access required",
    };
  }
  return toCoreApiActionError(error);
}

/**
 * The shape every campaign action shares: admin only, validated input, and
 * the list page refreshed after Core accepts the change.
 */
async function runCampaignAction<Input, Output>(
  session: Session,
  input: unknown,
  schema: z.ZodType<Input>,
  run: (parsed: Input) => Promise<Output>,
): Promise<ActionResultDto<Output, ActionError>> {
  try {
    assertAdminSession(session);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid badge campaign input",
        }),
      );
    }

    const output = await run(parsed.data);
    revalidatePath(ADMIN_BADGE_CAMPAIGNS_PATH);
    return toActionResult(ok(output));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
}

interface AdminBadgeCampaignParameters extends AuthenticatedRequest {
  input: unknown;
}

export const createAdminBadgeCampaignAction = withSession<
  AdminBadgeCampaignParameters,
  ActionResultDto<BadgeCampaign, ActionError>
>(({ input, session }) =>
  runCampaignAction(session, input, createSchema, (body) =>
    coreClient.createAdminBadgeCampaign(body),
  ),
);

export const updateAdminBadgeCampaignAction = withSession<
  AdminBadgeCampaignParameters,
  ActionResultDto<BadgeCampaign, ActionError>
>(({ input, session }) =>
  runCampaignAction(session, input, updateSchema, ({ id, ...campaignWindow }) =>
    coreClient.updateAdminBadgeCampaign(id, campaignWindow),
  ),
);

/** Ends a running campaign by Core's clock, not the admin's browser. */
export const endAdminBadgeCampaignAction = withSession<
  AdminBadgeCampaignParameters,
  ActionResultDto<BadgeCampaign, ActionError>
>(({ input, session }) =>
  runCampaignAction(session, input, campaignIdSchema, ({ id }) =>
    coreClient.endAdminBadgeCampaign(id),
  ),
);

export const deleteAdminBadgeCampaignAction = withSession<
  AdminBadgeCampaignParameters,
  ActionResultDto<void, ActionError>
>(({ input, session }) =>
  runCampaignAction(session, input, campaignIdSchema, ({ id }) =>
    coreClient.deleteAdminBadgeCampaign(id),
  ),
);
