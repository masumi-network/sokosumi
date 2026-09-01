"use server";

import { CORE_API_ERROR_KINDS, sanitizeChannelSlug } from "@sokosumi/utils";
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
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import {
  type AdminAddMatchedChannelFromOrganizationResult,
  type AdminArchivedMatchedChannel,
  type AdminMatchedChannelDetail,
  type AdminMatchedChannelOption,
  type AdminMatchedChannelParticipant,
  type AdminRemoveMatchedChannelParticipant,
  adminMatchedChannelsService,
} from "@/lib/services/admin-matched-channels.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const roomIdSchema = z.string().uuid();

const createMatchedChannelSchema = z.object({
  name: z.string().trim().max(80).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((value) => sanitizeChannelSlug(value))
    .refine((value) => value.length > 0, {
      message: "Invalid channel slug",
    }),
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
  if (
    error instanceof CoreApiRequestError &&
    error.kind === CORE_API_ERROR_KINDS.CHANNEL_SLUG_TAKEN
  ) {
    return {
      code: CORE_API_ERROR_KINDS.CHANNEL_SLUG_TAKEN,
      message: error.message,
    };
  }
  return toCoreApiActionError(error);
}

interface ListMatchedChannelsParameters extends AuthenticatedRequest {
  input?: unknown;
}

const listMatchedChannelsSchema = z.object({
  status: z.enum(["active", "archived"]).optional(),
});

export const listAdminMatchedChannelsAction = withSession<
  ListMatchedChannelsParameters,
  ActionResultDto<AdminMatchedChannelOption[], ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = listMatchedChannelsSchema.safeParse(input ?? {});
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid matched channel list input",
        }),
      );
    }

    const channels = await adminMatchedChannelsService.listMatchedChannels(
      parsed.data.status ? { status: parsed.data.status } : undefined,
    );
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

const removeParticipantSchema = z.object({
  roomId: roomIdSchema,
  userId: z.string().min(1),
});

interface RemoveParticipantParameters extends AuthenticatedRequest {
  input: unknown;
}

export const removeAdminMatchedChannelParticipantAction = withSession<
  RemoveParticipantParameters,
  ActionResultDto<AdminRemoveMatchedChannelParticipant, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = removeParticipantSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid participant remove input",
        }),
      );
    }

    const removed = await adminMatchedChannelsService.removeParticipant(
      parsed.data.roomId,
      parsed.data.userId,
    );
    revalidateMatchedChannelRoutes(parsed.data.roomId);
    return toActionResult(ok(removed));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});

const archiveMatchedChannelSchema = z.object({
  roomId: roomIdSchema,
});

interface ArchiveMatchedChannelParameters extends AuthenticatedRequest {
  input: unknown;
}

export const archiveAdminMatchedChannelAction = withSession<
  ArchiveMatchedChannelParameters,
  ActionResultDto<AdminArchivedMatchedChannel, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = archiveMatchedChannelSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid matched channel archive input",
        }),
      );
    }

    const archived = await adminMatchedChannelsService.archiveMatchedChannel(
      parsed.data.roomId,
    );
    revalidateMatchedChannelRoutes(parsed.data.roomId);
    return toActionResult(ok(archived));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});

const restoreMatchedChannelSchema = z.object({
  roomId: roomIdSchema,
});

interface RestoreMatchedChannelParameters extends AuthenticatedRequest {
  input: unknown;
}

export const restoreAdminMatchedChannelAction = withSession<
  RestoreMatchedChannelParameters,
  ActionResultDto<AdminMatchedChannelOption, ActionError>
>(async ({ input, session }) => {
  try {
    assertAdminSession(session);
    const parsed = restoreMatchedChannelSchema.safeParse(input);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Invalid matched channel restore input",
        }),
      );
    }

    const restored = await adminMatchedChannelsService.restoreMatchedChannel(
      parsed.data.roomId,
    );
    revalidateMatchedChannelRoutes(parsed.data.roomId);
    return toActionResult(ok(restored));
  } catch (error) {
    return toActionResult(err(toAdminActionError(error)));
  }
});
