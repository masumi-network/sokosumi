"use server";

import { MemberRole } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS, normalizeWebsiteUrl } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import * as z from "zod";
import { invalidatePrivateSidebarChrome } from "@/app/components/private-sidebar-cache";
import { getEnvSecrets } from "@/config/env.secrets";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { OrganizationErrorCode } from "@/lib/actions/errors/error-codes/organization";
import { CoreAuthUnavailableError } from "@/lib/auth/errors";
import { readRouteSession } from "@/lib/auth/route-session";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import {
  type BulkInviteResultRow,
  organizationService,
} from "@/lib/services/organization.service";
import { userService } from "@/lib/services/user.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const bulkInviteEmailsSchema = z.object({
  organizationId: z.string().min(1),
  rawEmails: z.string().min(1),
});

interface InviteOrganizationMembersBulkParameters extends AuthenticatedRequest {
  organizationId: string;
  rawEmails: string;
}

function parseBulkInviteEmails(rawEmails: string): string[] | null {
  const emailsByKey = new Map<string, string>();
  const emailSchema = z.email();

  for (const rawEmail of rawEmails.split(/[\n,;]+/)) {
    const email = rawEmail.trim();
    if (!email) continue;

    if (!emailSchema.safeParse(email).success) {
      return null;
    }

    const emailKey = email.toLowerCase();
    if (!emailsByKey.has(emailKey)) {
      emailsByKey.set(emailKey, email);
    }
  }

  return Array.from(emailsByKey.values());
}

export const inviteOrganizationMembersBulk = withSession<
  InviteOrganizationMembersBulkParameters,
  ActionResultDto<{ results: BulkInviteResultRow[] }, ActionError>
>(async ({ organizationId, rawEmails }) => {
  const parsedResult = bulkInviteEmailsSchema.safeParse({
    organizationId,
    rawEmails,
  });
  if (!parsedResult.success) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
        message: parsedResult.error.issues[0]?.message,
      }),
    );
  }

  const emails = parseBulkInviteEmails(parsedResult.data.rawEmails);
  if (!emails || emails.length === 0) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
        message: "Enter at least one valid email address",
      }),
    );
  }

  const invitationLimit = getEnvSecrets().ORG_INVITATION_LIMIT;
  if (emails.length > invitationLimit) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
        message: `You can invite up to ${invitationLimit} members at a time`,
      }),
    );
  }

  try {
    const member = await userService.getMyMemberInOrganization(
      parsedResult.data.organizationId,
    );

    if (!member) {
      return toActionResult(
        err({
          code: CommonErrorCode.UNAUTHORIZED,
          message: "You are not a member of this organization",
        }),
      );
    }

    if (!isOrganizationOwnerOrAdmin(member.role)) {
      return toActionResult(
        err({
          code: CommonErrorCode.UNAUTHORIZED,
          message: "Only organization owners and admins can invite members",
        }),
      );
    }

    return toActionResult(
      ok(
        await organizationService.inviteMultipleMembers(
          parsedResult.data.organizationId,
          emails,
          MemberRole.MEMBER,
        ),
      ),
    );
  } catch (error) {
    console.error("Failed to bulk invite organization members", error);
    return toActionResult(
      err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      }),
    );
  }
});

const updatePreferredOrganizationSchema = z.object({
  organizationId: z.string().min(1).nullable(),
});

interface UpdatePreferredOrganizationParameters extends AuthenticatedRequest {
  organizationId: string | null;
}

export const updatePreferredOrganization = withSession<
  UpdatePreferredOrganizationParameters,
  ActionResultDto<{ organizationId: string | null }, ActionError>
>(async ({ organizationId, session }) => {
  const parsedResult = updatePreferredOrganizationSchema.safeParse({
    organizationId,
  });

  if (!parsedResult.success) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
        message: parsedResult.error.issues[0]?.message,
      }),
    );
  }

  const previousOrganizationId = session.session.activeOrganizationId ?? null;
  const notMember = {
    code: CommonErrorCode.UNAUTHORIZED,
    message: "You are not a member of this organization",
  };
  const noPersonal = {
    code: CommonErrorCode.NOT_FOUND,
    message: "You have no personal workspace",
  };

  // Core prefers a workspace by id (ADR 0051); null means the personal one.
  const { data: list } = await coreClient.getMyWorkspaces();
  const workspace = list.workspaces.find((candidate) =>
    parsedResult.data.organizationId === null
      ? candidate.kind === "personal"
      : candidate.organizationId === parsedResult.data.organizationId,
  );
  if (!workspace) {
    return toActionResult(
      err(parsedResult.data.organizationId === null ? noPersonal : notMember),
    );
  }

  try {
    const { data } = await coreClient.setMyPreferredWorkspace(workspace.id);

    invalidatePrivateSidebarChrome({
      userId: session.user.id,
      organizationId: data.organizationId,
      previousOrganizationId,
    });

    return toActionResult(
      ok({
        organizationId: data.organizationId,
      }),
    );
  } catch (error) {
    // The workspace, membership or organization ended between the list and
    // the write.
    if (
      error instanceof CoreApiRequestError &&
      (error.kind === CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED ||
        error.status === 404)
    ) {
      return toActionResult(
        err(parsedResult.data.organizationId === null ? noPersonal : notMember),
      );
    }

    throw error;
  }
});

// Core's rules for this body (user-workspace.schema.ts): name 2 to 50, and a
// website it can normalize.
const createOrganizationWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(50),
  websiteUrl: z
    .string()
    .trim()
    .refine((value) => normalizeWebsiteUrl(value) !== null),
});

/**
 * Creates an organization owned by the signed-in user through Core's
 * workspaces resource (ADR 0051): Core generates the slug, stores the website
 * in its metadata and makes it preferred. Core's message is kept for the
 * person, as Better Auth's was. A signed-out person gets UNAUTHENTICATED back
 * rather than a throw, so the wizard can offer sign in.
 */
export async function createOrganizationWorkspaceAction({
  name,
  websiteUrl,
}: {
  name: string;
  websiteUrl: string;
}): Promise<ActionResultDto<{ organizationId: string }, ActionError>> {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable") {
    throw new CoreAuthUnavailableError(sessionRead.reason);
  }
  if (sessionRead.status === "signedOut") {
    return toActionResult(err({ code: CommonErrorCode.UNAUTHENTICATED }));
  }

  const parsedResult = createOrganizationWorkspaceSchema.safeParse({
    name,
    websiteUrl,
  });
  if (!parsedResult.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    const { data } = await coreClient.createMyWorkspace({
      kind: "organization",
      ...parsedResult.data,
    });
    if (!data.organizationId) {
      throw new Error("Core created an organization without an id");
    }
    return toActionResult(ok({ organizationId: data.organizationId }));
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      const code =
        error.status === 401
          ? CommonErrorCode.UNAUTHENTICATED
          : error.status === 403
            ? OrganizationErrorCode.ORGANIZATION_LIMIT_REACHED
            : error.status === 400 || error.status === 422
              ? CommonErrorCode.BAD_INPUT
              : null;
      if (code) {
        return toActionResult(err({ code, message: error.message }));
      }
    }
    console.error("Failed to create organization", error);
    return toActionResult(err({ code: CommonErrorCode.INTERNAL_SERVER_ERROR }));
  }
}
