"use server";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import * as z from "zod";
import { invalidatePrivateSidebarChrome } from "@/app/components/private-sidebar-cache";
import { getEnvSecrets } from "@/config/env.secrets";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import { MemberRole } from "@/lib/clients/generated/core";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import {
  type OrganizationInformationFormSchemaType,
  organizationInformationFormSchema,
} from "@/lib/schemas";
import {
  type BulkInviteResultRow,
  organizationService,
} from "@/lib/services/organization.service";
import { userService } from "@/lib/services/user.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

export async function generateOrganizationSlug(
  data: OrganizationInformationFormSchemaType,
): Promise<ActionResultDto<string, ActionError>> {
  try {
    const parsedResult = organizationInformationFormSchema().safeParse(data);
    if (!parsedResult.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
        }),
      );
    }

    const slug = await organizationService.generateOrganizationSlugFromName(
      parsedResult.data.name,
    );

    return toActionResult(ok(slug));
  } catch (error) {
    console.error("Error generating organization slug", error);
    return toActionResult(
      err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      }),
    );
  }
}

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

  try {
    const { data } = await coreClient.setMyPreferredOrganization(
      parsedResult.data.organizationId,
    );

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
    if (
      error instanceof CoreApiRequestError &&
      error.kind === CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED
    ) {
      return toActionResult(
        err({
          code: CommonErrorCode.UNAUTHORIZED,
          message: "You are not a member of this organization",
        }),
      );
    }

    throw error;
  }
});
