"use server";

import * as z from "zod";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import { Err, Ok, type Result } from "@/lib/ts-res";
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
  Result<void, ActionError>
>(async ({ session, slug, userId, role }) => {
  const parsed = addMemberSchema.safeParse({ slug, userId, role });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    assertAdminSession(session);
    await coreClient.addAdminOrganizationMember(parsed.data.slug, {
      userId: parsed.data.userId,
      role: parsed.data.role,
    });
    return Ok(undefined);
  } catch (error) {
    return Err(mapMemberActionError(error, "Failed to add member"));
  }
});

interface AdminOrganizationMemberRequest extends AuthenticatedRequest {
  slug: string;
  memberId: string;
}

export const removeAdminOrganizationMemberAction = withSession<
  AdminOrganizationMemberRequest,
  Result<void, ActionError>
>(async ({ session, slug, memberId }) => {
  const parsed = memberMutationSchema.safeParse({ slug, memberId });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    assertAdminSession(session);
    await coreClient.removeAdminOrganizationMember(
      parsed.data.slug,
      parsed.data.memberId,
    );
    return Ok(undefined);
  } catch (error) {
    return Err(mapMemberActionError(error, "Failed to remove member"));
  }
});

interface UpdateAdminOrganizationMemberRoleRequest
  extends AdminOrganizationMemberRequest {
  role: "owner" | "admin" | "member";
}

export const updateAdminOrganizationMemberRoleAction = withSession<
  UpdateAdminOrganizationMemberRoleRequest,
  Result<void, ActionError>
>(async ({ session, slug, memberId, role }) => {
  const parsed = updateRoleSchema.safeParse({ slug, memberId, role });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    assertAdminSession(session);
    await coreClient.updateAdminOrganizationMemberRole(
      parsed.data.slug,
      parsed.data.memberId,
      { role: parsed.data.role },
    );
    return Ok(undefined);
  } catch (error) {
    return Err(mapMemberActionError(error, "Failed to update member role"));
  }
});

export const assignAdminOrganizationMemberSeatAction = withSession<
  AdminOrganizationMemberRequest,
  Result<void, ActionError>
>(async ({ session, slug, memberId }) => {
  const parsed = memberMutationSchema.safeParse({ slug, memberId });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    assertAdminSession(session);
    await coreClient.assignAdminOrganizationMemberSeat(
      parsed.data.slug,
      parsed.data.memberId,
    );
    return Ok(undefined);
  } catch (error) {
    return Err(mapMemberActionError(error, "Failed to assign seat"));
  }
});

export const unassignAdminOrganizationMemberSeatAction = withSession<
  AdminOrganizationMemberRequest,
  Result<void, ActionError>
>(async ({ session, slug, memberId }) => {
  const parsed = memberMutationSchema.safeParse({ slug, memberId });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    assertAdminSession(session);
    await coreClient.unassignAdminOrganizationMemberSeat(
      parsed.data.slug,
      parsed.data.memberId,
    );
    return Ok(undefined);
  } catch (error) {
    return Err(mapMemberActionError(error, "Failed to unassign seat"));
  }
});
