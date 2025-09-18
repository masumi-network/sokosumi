"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth/auth";
import { authClient } from "@/lib/auth/auth.client";
import { getSession } from "@/lib/auth/utils";
import { MemberRole } from "@/lib/db";
import { userRepository } from "@/lib/db/repositories";
import { stripeService } from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";

import { ActionError, CommonErrorCode } from "./errors";
import { generateOrganizationSlug } from "./organization";

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
    const hasEmails = invitedEmails.length > 0;

    // This feature is only for inviting brand-new users: block emails that already have a user account
    if (hasEmails) {
      const normalizedEmails = Array.from(
        new Set(
          invitedEmails
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e.length > 0),
        ),
      );

      const users = await Promise.all(
        normalizedEmails.map((email) => userRepository.getUserByEmail(email)),
      );
      const existingUserEmails = users
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => u.email.toLowerCase());

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
      // 1) Create organization (external call)
      const slugResult = await generateOrganizationSlug({
        name: organizationName,
      });
      if (!slugResult.ok) {
        throw new Error(t("failedToCreateSlug"));
      }

      const slug = slugResult.data;

      const organization = await auth.api.createOrganization({
        body: {
          name: organizationName,
          slug: slug,
          userId: session.user.id,
        },
        headers: {
          cookie: await getSessionCookieHeader(),
        },
      });

      if (!organization) throw new Error(t("failedToCreateOrganization"));

      // 2) Create and apply referral credits (Stripe) based on invite count
      await stripeService.createAndApplyReferralCredits(
        session.user.id,
        organization.id,
        invitedEmails.length,
      );

      // 3) Invite members using the standard organization invite flow
      const cookie = await getSessionCookieHeader();
      for (const email of invitedEmails) {
        await authClient.organization.inviteMember(
          {
            email,
            organizationId: organization.id,
            role: MemberRole.MEMBER,
            resend: true,
          },
          { headers: { cookie } },
        );
      }

      console.log("Invitations sent", invitedEmails);

      // Update Better Auth session flag
      await auth.api.updateUser({
        headers: {
          cookie: await getSessionCookieHeader(),
        },
        body: { onboardingCompleted: true },
      });

      revalidatePath("/");
      return Ok({ redirectUrl: "/agents" });
    } else {
      // Just mark onboarding as completed (equivalent to skip)
      await auth.api.updateUser({
        headers: { cookie: await getSessionCookieHeader() },
        body: { onboardingCompleted: true },
      });

      revalidatePath("/");
      return Ok({ redirectUrl: "/agents" });
    }
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
    const t = await getTranslations("Onboarding.Actions.Errors");
    const session = await getSession();
    if (!session) {
      return Err({
        code: CommonErrorCode.UNAUTHENTICATED,
        message: t("notAuthenticated"),
      });
    }

    // Mark onboarding as completed without creating anything
    await auth.api.updateUser({
      headers: { cookie: await getSessionCookieHeader() },
      body: { onboardingCompleted: true },
    });

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

async function getSessionCookieHeader(): Promise<string> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  return cookieStore.toString();
}
