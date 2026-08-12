"use server";

import { err, ok } from "neverthrow";
import * as z from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  AcceptOrganizationInviteLink,
  OrganizationInviteLink,
  ResolveOrganizationInviteLink,
} from "@/lib/clients/generated/core";
import { parseOrganizationInviteToken } from "@/lib/utils/invite-link-token";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

function toActionError(error: unknown): ActionError {
  if (error instanceof CoreApiRequestError) {
    if (error.status === 401) {
      return { code: CommonErrorCode.UNAUTHENTICATED, message: error.message };
    }
    if (error.status === 403) {
      return { code: CommonErrorCode.UNAUTHORIZED, message: error.message };
    }
    if (error.status === 404) {
      return { code: CommonErrorCode.NOT_FOUND, message: error.message };
    }
    if (error.status === 400) {
      return { code: CommonErrorCode.BAD_INPUT, message: error.message };
    }
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message: error instanceof Error ? error.message : undefined,
  };
}

const createInviteLinkSchema = z.object({
  organizationId: z.string().min(1),
  expiresInDays: z.number().int().min(1).max(90).optional(),
  maxUses: z.number().int().min(1).max(10000).nullable().optional(),
});

interface CreateOrganizationInviteLinkParameters extends AuthenticatedRequest {
  organizationId: string;
  expiresInDays?: number;
  maxUses?: number | null;
}

export const createOrganizationInviteLink = withSession<
  CreateOrganizationInviteLinkParameters,
  ActionResultDto<OrganizationInviteLink, ActionError>
>(async ({ organizationId, expiresInDays, maxUses }) => {
  const parsed = createInviteLinkSchema.safeParse({
    organizationId,
    expiresInDays,
    maxUses,
  });
  if (!parsed.success) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
        message: parsed.error.issues[0]?.message,
      }),
    );
  }

  try {
    const { data } = await coreClient.createOrganizationInviteLink(
      parsed.data.organizationId,
      {
        ...(parsed.data.expiresInDays !== undefined
          ? { expiresInDays: parsed.data.expiresInDays }
          : {}),
        ...(parsed.data.maxUses !== undefined
          ? { maxUses: parsed.data.maxUses }
          : {}),
      },
    );
    return toActionResult(ok(data));
  } catch (error) {
    console.error("Failed to create organization invite link", error);
    return toActionResult(err(toActionError(error)));
  }
});

interface RevokeOrganizationInviteLinkParameters extends AuthenticatedRequest {
  organizationId: string;
  token: string;
}

export const revokeOrganizationInviteLink = withSession<
  RevokeOrganizationInviteLinkParameters,
  ActionResultDto<null, ActionError>
>(async ({ organizationId, token }) => {
  if (!organizationId || !token) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    await coreClient.revokeOrganizationInviteLink(organizationId, token);
    return toActionResult(ok(null));
  } catch (error) {
    console.error("Failed to revoke organization invite link", error);
    return toActionResult(err(toActionError(error)));
  }
});

interface ResolveOrganizationInviteLinkPreviewParameters
  extends AuthenticatedRequest {
  /** A pasted `/join/<token>` URL or the bare token. */
  tokenOrUrl: string;
}

export interface OrganizationInviteLinkPreview
  extends ResolveOrganizationInviteLink {
  /** The token the input resolved to, for the follow-up accept call. */
  token: string;
}

/**
 * Resolves a pasted invite link so the onboarding flow can show which
 * organization it leads to before the user commits to joining.
 */
export const resolveOrganizationInviteLinkPreview = withSession<
  ResolveOrganizationInviteLinkPreviewParameters,
  ActionResultDto<OrganizationInviteLinkPreview, ActionError>
>(async ({ tokenOrUrl }) => {
  const token = parseOrganizationInviteToken(tokenOrUrl);
  if (!token) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    const { data } = await coreClient.resolveOrganizationInviteLink(token);
    return toActionResult(ok({ ...data, token }));
  } catch (error) {
    console.error("Failed to resolve organization invite link", error);
    return toActionResult(err(toActionError(error)));
  }
});

interface AcceptOrganizationInviteLinkParameters extends AuthenticatedRequest {
  token: string;
}

export const acceptOrganizationInviteLink = withSession<
  AcceptOrganizationInviteLinkParameters,
  ActionResultDto<AcceptOrganizationInviteLink, ActionError>
>(async ({ token }) => {
  if (!token) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    const { data } = await coreClient.acceptOrganizationInviteLink(token);
    return toActionResult(ok(data));
  } catch (error) {
    console.error("Failed to accept organization invite link", error);
    return toActionResult(err(toActionError(error)));
  }
});
