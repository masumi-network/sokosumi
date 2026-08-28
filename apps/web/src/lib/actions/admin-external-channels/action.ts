"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import {
  type AdminExternalChannelDetail,
  type AdminExternalChannelGuest,
  type AdminExternalChannelOption,
  adminExternalChannelsService,
} from "@/lib/services/admin-external-channels.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const organizationSlugSchema = z.string().trim().min(1);
const roomIdSchema = z.string().uuid();

const createExternalChannelSchema = z.object({
  organizationSlug: organizationSlugSchema,
  name: z.string().trim().max(80).optional(),
  slug: z.string().trim().min(1).max(80),
  topic: z.string().trim().max(200).optional(),
});

const listExternalChannelsSchema = z.object({
  organizationSlug: organizationSlugSchema,
});

const getExternalChannelSchema = z.object({
  organizationSlug: organizationSlugSchema,
  roomId: roomIdSchema,
});

const addGuestSchema = z.object({
  organizationSlug: organizationSlugSchema,
  roomId: roomIdSchema,
  userId: z.string().min(1),
});

function revalidateExternalChannelRoutes(
  organizationSlug: string,
  roomId?: string,
) {
  revalidatePath("/admin/external-channels");
  if (roomId) {
    revalidatePath(`/admin/external-channels/${organizationSlug}/${roomId}`);
  }
}

function toAdminActionError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      message: "Admin access required",
    };
  }
  return toCoreApiActionError(error);
}

interface ListExternalChannelsParameters extends AuthenticatedRequest {
  input: unknown;
}

export const listAdminExternalChannelsAction = withSession<
  ListExternalChannelsParameters,
  ActionResultDto<AdminExternalChannelOption[], ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = listExternalChannelsSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid organization slug",
        }),
      );
    }

    const channels = await adminExternalChannelsService.listExternalChannels(
      parsed.data.organizationSlug,
    );
    return toActionResult(ok(channels));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});

interface CreateExternalChannelParameters extends AuthenticatedRequest {
  input: unknown;
}

export const createAdminExternalChannelAction = withSession<
  CreateExternalChannelParameters,
  ActionResultDto<AdminExternalChannelOption, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = createExternalChannelSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid external channel input",
        }),
      );
    }

    const { organizationSlug, name, slug, topic } = parsed.data;
    const channel = await adminExternalChannelsService.createExternalChannel(
      organizationSlug,
      {
        slug,
        ...(name ? { name } : {}),
        ...(topic ? { topic } : {}),
      },
    );
    revalidateExternalChannelRoutes(organizationSlug, channel.id);
    return toActionResult(ok(channel));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});

interface GetExternalChannelParameters extends AuthenticatedRequest {
  input: unknown;
}

export const getAdminExternalChannelAction = withSession<
  GetExternalChannelParameters,
  ActionResultDto<AdminExternalChannelDetail, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = getExternalChannelSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid external channel lookup",
        }),
      );
    }

    const channel = await adminExternalChannelsService.getExternalChannel(
      parsed.data.organizationSlug,
      parsed.data.roomId,
    );
    return toActionResult(ok(channel));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});

interface AddGuestParameters extends AuthenticatedRequest {
  input: unknown;
}

export const addAdminExternalChannelGuestAction = withSession<
  AddGuestParameters,
  ActionResultDto<AdminExternalChannelGuest, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = addGuestSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid guest input",
        }),
      );
    }

    const guest = await adminExternalChannelsService.addGuest(
      parsed.data.organizationSlug,
      parsed.data.roomId,
      parsed.data.userId,
    );
    revalidateExternalChannelRoutes(
      parsed.data.organizationSlug,
      parsed.data.roomId,
    );
    return toActionResult(ok(guest));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});
