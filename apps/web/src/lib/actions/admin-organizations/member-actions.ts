"use server";

import { err, ok } from "neverthrow";
import * as z from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const memberRoleSchema = z.enum(["owner", "admin", "member"]);

const addMemberSchema = z.object({
  slug: z.string().min(1),
  userId: z.string().min(1),
  role: memberRoleSchema.default("member"),
});

const addGuestSchema = z.object({
  slug: z.string().min(1),
  roomId: z.string().uuid(),
  userId: z.string().min(1),
});

const memberMutationSchema = z.object({
  slug: z.string().min(1),
  memberId: z.string().min(1),
});

const updateRoleSchema = memberMutationSchema.extend({
  role: memberRoleSchema,
});

function mapMemberActionError(error: unknown, fallback: string): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      message: error.message,
    };
  }

  if (error instanceof CoreApiRequestError) {
    if (error.status === 400 || error.status === 404 || error.status === 409) {
      return {
        code: CommonErrorCode.BAD_INPUT,
        message: error.message ?? fallback,
      };
    }
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message: error instanceof Error ? error.message : fallback,
  };
}

interface AddAdminOrganizationMemberRequest extends AuthenticatedRequest {
  slug: string;
  userId: string;
  role: "owner" | "admin" | "member";
}

export const addAdminOrganizationMemberAction = withSession<
  AddAdminOrganizationMemberRequest,
  ActionResultDto<void, ActionError>
>(async ({ session, slug, userId, role }) => {
  const parsed = addMemberSchema.safeParse({ slug, userId, role });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    assertAdminSession(session);
    await coreClient.addAdminOrganizationMember(parsed.data.slug, {
      userId: parsed.data.userId,
      role: parsed.data.role,
    });
    return toActionResult(ok(undefined));
  } catch (error) {
    return toActionResult(
      err(mapMemberActionError(error, "Failed to add member")),
    );
  }
});

interface AddAdminExternalChannelGuestRequest extends AuthenticatedRequest {
  slug: string;
  roomId: string;
  userId: string;
}

export const addAdminExternalChannelGuestAction = withSession<
  AddAdminExternalChannelGuestRequest,
  ActionResultDto<{ outcome: "joined" | "already_guest" }, ActionError>
>(async ({ session, slug, roomId, userId }) => {
  const parsed = addGuestSchema.safeParse({ slug, roomId, userId });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    assertAdminSession(session);
    const result = await coreClient.addAdminExternalChannelGuest(
      parsed.data.slug,
      parsed.data.roomId,
      { userId: parsed.data.userId },
    );
    return toActionResult(ok({ outcome: result.data.outcome }));
  } catch (error) {
    return toActionResult(
      err(mapMemberActionError(error, "Failed to add guest")),
    );
  }
});

interface AdminOrganizationMemberRequest extends AuthenticatedRequest {
  slug: string;
  memberId: string;
}

export const removeAdminOrganizationMemberAction = withSession<
  AdminOrganizationMemberRequest,
  ActionResultDto<void, ActionError>
>(async ({ session, slug, memberId }) => {
  const parsed = memberMutationSchema.safeParse({ slug, memberId });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    assertAdminSession(session);
    await coreClient.removeAdminOrganizationMember(
      parsed.data.slug,
      parsed.data.memberId,
    );
    return toActionResult(ok(undefined));
  } catch (error) {
    return toActionResult(
      err(mapMemberActionError(error, "Failed to remove member")),
    );
  }
});

interface UpdateAdminOrganizationMemberRoleRequest
  extends AdminOrganizationMemberRequest {
  role: "owner" | "admin" | "member";
}

export const updateAdminOrganizationMemberRoleAction = withSession<
  UpdateAdminOrganizationMemberRoleRequest,
  ActionResultDto<void, ActionError>
>(async ({ session, slug, memberId, role }) => {
  const parsed = updateRoleSchema.safeParse({ slug, memberId, role });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    assertAdminSession(session);
    await coreClient.updateAdminOrganizationMemberRole(
      parsed.data.slug,
      parsed.data.memberId,
      { role: parsed.data.role },
    );
    return toActionResult(ok(undefined));
  } catch (error) {
    return toActionResult(
      err(mapMemberActionError(error, "Failed to update member role")),
    );
  }
});

export const assignAdminOrganizationMemberSeatAction = withSession<
  AdminOrganizationMemberRequest,
  ActionResultDto<void, ActionError>
>(async ({ session, slug, memberId }) => {
  const parsed = memberMutationSchema.safeParse({ slug, memberId });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    assertAdminSession(session);
    await coreClient.assignAdminOrganizationMemberSeat(
      parsed.data.slug,
      parsed.data.memberId,
    );
    return toActionResult(ok(undefined));
  } catch (error) {
    return toActionResult(
      err(mapMemberActionError(error, "Failed to assign seat")),
    );
  }
});

export const unassignAdminOrganizationMemberSeatAction = withSession<
  AdminOrganizationMemberRequest,
  ActionResultDto<void, ActionError>
>(async ({ session, slug, memberId }) => {
  const parsed = memberMutationSchema.safeParse({ slug, memberId });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    assertAdminSession(session);
    await coreClient.unassignAdminOrganizationMemberSeat(
      parsed.data.slug,
      parsed.data.memberId,
    );
    return toActionResult(ok(undefined));
  } catch (error) {
    return toActionResult(
      err(mapMemberActionError(error, "Failed to unassign seat")),
    );
  }
});
