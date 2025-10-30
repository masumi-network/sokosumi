"use server";

import { MemberRole } from "@sokosumi/database";
import { userRepository } from "@sokosumi/database/repositories";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { getSession } from "@/lib/auth/utils";
import {
  organizationService,
  stripeService,
  userService,
} from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";

export async function completeOnboarding(
  organizationName: string | null,
  invitedEmails: string[],
): Promise<Result<{ redirectUrl: string }, ActionError>> {
  try {
    const t = await getTranslations("Onboarding.Actions.Errors");
    const session = await getSession();
    if (!session) {
      return Err({
        code: CommonErrorCode.UNAUTHENTICATED,
        message: t("notAuthenticated"),
      });
    }

    const hasOrgName = organizationName && organizationName.trim().length > 0;
    const deduplicatedInvitedEmails = Array.from(new Set(invitedEmails));
    const hasEmails = deduplicatedInvitedEmails.length > 0;

    // Check if any invited emails already have user accounts
    if (hasEmails) {
      const existingUserEmails = await userService.checkExistingUsers(
        deduplicatedInvitedEmails,
      );

      if (existingUserEmails.length > 0) {
        return Err({
          code: CommonErrorCode.BAD_INPUT,
          message: t("alreadyRegisteredUsers", {
            emails: existingUserEmails.join(", "),
          }),
        });
      }
    }

    // Validation - both required or neither
    if (hasOrgName !== hasEmails) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: t("orgAndEmailsRequired"),
      });
    }

    if (hasOrgName && hasEmails) {
      // Create organization with the user as owner
      const organization =
        await organizationService.createOrganizationWithOwner(
          organizationName,
          session.user.id,
        );

      if (!organization) {
        throw new Error(t("failedToCreateOrganization"));
      }

      // Invite members in batch
      await organizationService.inviteMultipleMembers(
        organization.id,
        deduplicatedInvitedEmails,
        MemberRole.MEMBER,
      );

      // Create and apply referral credits based on invite count
      await stripeService.createAndApplyReferralCredits(
        session.user.id,
        organization.id,
        deduplicatedInvitedEmails.length,
      );
    }

    // Mark onboarding as completed
    await userRepository.updateUserOnboardingCompleted(session.user.id, true);

    revalidatePath("/");
    return Ok({ redirectUrl: "/agents" });
  } catch (error) {
    console.error("Error completing onboarding:", error);
    const t = await getTranslations("Onboarding.Actions.Errors");
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: error instanceof Error ? error.message : t("failedToComplete"),
    });
  }
}

export async function skipOnboarding(): Promise<
  Result<{ redirectUrl: string }, ActionError>
> {
  try {
    // Mark onboarding as completed without creating anything
    await userService.markOnboardingCompleteForMe();

    revalidatePath("/");
    return Ok({ redirectUrl: "/agents" });
  } catch (error) {
    console.error("Error skipping onboarding:", error);
    const t = await getTranslations("Onboarding.Actions.Errors");
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: error instanceof Error ? error.message : t("failedToSkip"),
    });
  }
}
