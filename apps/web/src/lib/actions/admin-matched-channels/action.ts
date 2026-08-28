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
  type AdminAddMatchedChannelFromOrganizationResult,
  type AdminMatchedChannelDetail,
  type AdminMatchedChannelOption,
  type AdminMatchedChannelParticipant,
  adminMatchedChannelsService,
} from "@/lib/services/admin-matched-channels.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const roomIdSchema = z.string().uuid();

const createMatchedChannelSchema = z.object({
  name: z.string().trim().max(80).optional(),
  slug: z.string().trim().min(1).max(80),
  topic: z.string().trim().max(200).optional(),
});

const getMatchedChannelSchema = z.object({
  roomId: roomIdSchema,
});

const addParticipantSchema = z.object({
  roomId: roomIdSchema,
  userId: z.string().min(1),
});

const addFromOrganizationSchema = z
  .object({
    roomId: roomIdSchema,
    organizationId: z.string().min(1).optional(),
    organizationSlug: z.string().min(1).optional(),
  })
  .refine(
    (data) =>
      (data.organizationId != null && data.organizationSlug == null) ||
      (data.organizationId == null && data.organizationSlug != null),
    { message: "Provide exactly one of organizationId or organizationSlug" },
  );

function revalidateMatchedChannelRoutes(roomId?: string) {
  revalidatePath("/admin/matched-channels");
  if (roomId) {
    revalidatePath(`/admin/matched-channels/${roomId}`);
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

interface ListMatchedChannelsParameters extends AuthenticatedRequest {}

export const listAdminMatchedChannelsAction = withSession<
  ListMatchedChannelsParameters,
  ActionResultDto<AdminMatchedChannelOption[], ActionError>
>(async ({ session }) => {
  try {
    assertAdminSession(session);
    const channels = await adminMatchedChannelsService.listMatchedChannels();
    return toActionResult(ok(channels));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});

interface CreateMatchedChannelParameters extends AuthenticatedRequest {
  input: unknown;
}

export const createAdminMatchedChannelAction = withSession<
  CreateMatchedChannelParameters,
  ActionResultDto<AdminMatchedChannelOption, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = createMatchedChannelSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid matched channel input",
        }),
      );
    }

    const { name, slug, topic } = parsed.data;
    const channel = await adminMatchedChannelsService.createMatchedChannel({
      slug,
      ...(name ? { name } : {}),
      ...(topic ? { topic } : {}),
    });
    revalidateMatchedChannelRoutes(channel.id);
    return toActionResult(ok(channel));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});

interface GetMatchedChannelParameters extends AuthenticatedRequest {
  input: unknown;
}

export const getAdminMatchedChannelAction = withSession<
  GetMatchedChannelParameters,
  ActionResultDto<AdminMatchedChannelDetail, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = getMatchedChannelSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid matched channel lookup",
        }),
      );
    }

    const channel = await adminMatchedChannelsService.getMatchedChannel(
      parsed.data.roomId,
    );
    return toActionResult(ok(channel));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});

interface AddParticipantParameters extends AuthenticatedRequest {
  input: unknown;
}

export const addAdminMatchedChannelParticipantAction = withSession<
  AddParticipantParameters,
  ActionResultDto<AdminMatchedChannelParticipant, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = addParticipantSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid participant input",
        }),
      );
    }

    const participant = await adminMatchedChannelsService.addParticipant(
      parsed.data.roomId,
      parsed.data.userId,
    );
    revalidateMatchedChannelRoutes(parsed.data.roomId);
    return toActionResult(ok(participant));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});

interface AddFromOrganizationParameters extends AuthenticatedRequest {
  input: unknown;
}

export const addAdminMatchedChannelParticipantsFromOrganizationAction =
  withSession<
    AddFromOrganizationParameters,
    ActionResultDto<AdminAddMatchedChannelFromOrganizationResult, ActionError>
  >(async ({ input, session }) => {
    try {
      assertAdminSession(session);
      const parsed = addFromOrganizationSchema.safeParse(input);
      if (!parsed.success) {
        return toActionResult(
          err({
            code: CommonErrorCode.BAD_INPUT,
            message: "Invalid organization snapshot input",
          }),
        );
      }

      const { roomId, organizationId, organizationSlug } = parsed.data;
      let result: AdminAddMatchedChannelFromOrganizationResult;
      if (organizationId != null) {
        result =
          await adminMatchedChannelsService.addParticipantsFromOrganization(
            roomId,
            { organizationId },
          );
      } else if (organizationSlug != null) {
        result =
          await adminMatchedChannelsService.addParticipantsFromOrganization(
            roomId,
            { organizationSlug },
          );
      } else {
        return toActionResult(
          err({
            code: CommonErrorCode.BAD_INPUT,
            message: "Invalid organization snapshot input",
          }),
        );
      }
      revalidateMatchedChannelRoutes(roomId);
      return toActionResult(ok(result));
    } catch (error) {
      return toActionResult(err(toAdminActionError(error)));
    }
  });
