"use server";

import { AnnouncedFeature, type BadgeCampaign } from "@sokosumi/core-client";
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

const windowSchema = z.object({
  startsAt: z.iso.datetime().transform((value) => new Date(value)),
  endsAt: z.iso.datetime().transform((value) => new Date(value)),
});

const createSchema = windowSchema.extend({
  feature: z.enum(AnnouncedFeature),
});

const updateSchema = windowSchema.extend({
  id: z.string().min(1),
});

const deleteSchema = z.object({ id: z.string().min(1) });

const BAD_INPUT: ActionError = {
  code: CommonErrorCode.BAD_INPUT,
  message: "Invalid badge campaign input",
};

function toAdminActionError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      message: "Admin access required",
    };
  }
  return toCoreApiActionError(error);
}

interface AdminBadgeCampaignParameters extends AuthenticatedRequest {
  input: unknown;
}

export const createAdminBadgeCampaignAction = withSession<
  AdminBadgeCampaignParameters,
  ActionResultDto<BadgeCampaign, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(err(BAD_INPUT));
    }

    const campaign = await coreClient.createAdminBadgeCampaign(parsed.data);
    revalidatePath(ADMIN_BADGE_CAMPAIGNS_PATH);
    return toActionResult(ok(campaign));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});

export const updateAdminBadgeCampaignAction = withSession<
  AdminBadgeCampaignParameters,
  ActionResultDto<BadgeCampaign, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(err(BAD_INPUT));
    }

    const { id, ...window } = parsed.data;
    const campaign = await coreClient.updateAdminBadgeCampaign(id, window);
    revalidatePath(ADMIN_BADGE_CAMPAIGNS_PATH);
    return toActionResult(ok(campaign));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});

export const deleteAdminBadgeCampaignAction = withSession<
  AdminBadgeCampaignParameters,
  ActionResultDto<void, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(err(BAD_INPUT));
    }

    await coreClient.deleteAdminBadgeCampaign(parsed.data.id);
    revalidatePath(ADMIN_BADGE_CAMPAIGNS_PATH);
    return toActionResult(ok(undefined));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});
