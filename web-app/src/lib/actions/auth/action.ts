"use server";

import { User } from "better-auth";

import {
  ActionError,
  AuthErrorCode,
  betterAuthApiErrorSchema,
  CommonErrorCode,
  removeUTMCookie,
} from "@/lib/actions";
import { auth } from "@/lib/auth/auth";
import { MemberRole } from "@/lib/db";
import {
  acceptValidPendingInvitationById,
  createMember,
  createOrganization,
  createUTMAttribution,
  prisma,
  retrieveMembersByOrganizationId,
  retrieveOrganizationWithRelationsById,
  retrieveValidPendingInvitationById,
} from "@/lib/db/repositories";
import { signUpFormSchema, SignUpFormSchemaType } from "@/lib/schemas";
import {
  generateOrganizationSlugFromName,
  getUTMDataFromCookie,
} from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";
import { getEmailDomain, removePublicDomains } from "@/lib/utils";
import { Member, Organization } from "@/prisma/generated/client";

export async function signInSocial(
  provider: "google" | "microsoft" | "apple" | "linkedin",
): Promise<Result<void, ActionError>> {
  try {
    await auth.api.signInSocial({
      body: {
        provider: provider,
      },
    });
    return Ok();
  } catch (error) {
    console.error("Error signing in with social provider", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

export async function signUpEmail(
  data: SignUpFormSchemaType,
  invitationId?: string | undefined,
): Promise<
  Result<
    { organization: Organization; member: Member; user: User },
    ActionError
  >
> {
  let actionError: ActionError = {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message: "Internal server error",
  };

  try {
    const parsedResult = signUpFormSchema().safeParse(data);
    if (!parsedResult.success) {
      return Err({
        message: "Bad Input",
        code: CommonErrorCode.BAD_INPUT,
      });
    }
    const parsed = parsedResult.data;

    const result = await prisma.$transaction(async (tx) => {
      // organization check
      let organization: Organization;
      let organizationCreated: boolean = false;
      if (!!parsed.selectedOrganization.id) {
        const retrievedOrganization =
          await retrieveOrganizationWithRelationsById(
            parsed.selectedOrganization.id,
            tx,
          );
        if (!retrievedOrganization) {
          actionError = {
            code: AuthErrorCode.ORGANIZATION_NOT_FOUND,
            message: "Organization not found",
          };
          throw new Error("Organization not found");
        }
        organization = retrievedOrganization;
      } else if (!!parsed.selectedOrganization.name) {
        const emailDomain = getEmailDomain(parsed.email);
        if (!emailDomain) {
          actionError = {
            code: AuthErrorCode.EMAIL_DOMAIN_INVALID,
            message: "Email domain is invalid",
          };
          throw new Error("Email domain is invalid");
        }
        const requiredEmailDomains = removePublicDomains([emailDomain]);
        const slug = await generateOrganizationSlugFromName(
          parsed.selectedOrganization.name,
        );

        const createdOrganization = await createOrganization(
          slug,
          parsed.selectedOrganization.name,
          requiredEmailDomains,
          tx,
        );
        if (!createdOrganization) {
          actionError = {
            code: AuthErrorCode.ORGANIZATION_CREATE_FAILED,
            message: "Organization creation failed",
          };
          throw new Error("Organization creation failed");
        }
        organization = createdOrganization;
        organizationCreated = true;
      } else {
        actionError = {
          code: CommonErrorCode.BAD_INPUT,
          message: "Bad Input",
        };
        throw new Error("Bad Input");
      }

      // check user can join organization
      // whether his email domain is allowed by organization
      // or invited to organization
      const userEmailDomain = getEmailDomain(parsed.email);
      const isUserEmailAllowed =
        organizationCreated ||
        (userEmailDomain &&
          organization.requiredEmailDomains.includes(userEmailDomain));

      const invitation = invitationId
        ? await retrieveValidPendingInvitationById(invitationId, tx)
        : undefined;
      const isValidInvitationUsed =
        invitation && invitation.organizationId === organization.id;

      if (!isUserEmailAllowed && !isValidInvitationUsed) {
        if (invitationId) {
          actionError = {
            code: AuthErrorCode.INVITATION_NOT_FOUND,
            message: "Invitation not found",
          };
          throw new Error("Invitation not found");
        } else {
          actionError = {
            code: AuthErrorCode.EMAIL_NOT_ALLOWED_BY_ORGANIZATION,
            message: "Email not allowed by organization",
          };
          throw new Error("Email not allowed by organization");
        }
      }

      if (invitation) {
        await acceptValidPendingInvitationById(invitation.id, tx);
      }

      const signUpResult = await auth.api.signUpEmail({
        body: {
          email: parsed.email,
          name: parsed.name,
          password: parsed.password,
          callbackURL: "/",
          termsAccepted: parsed.termsAccepted,
        },
      });
      const user = signUpResult.user;
      if (!user) {
        console.error("Sign up email returned no user");
        actionError = {
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
          message: "Internal server error",
        };
        throw new Error("Internal server error");
      }

      // check if organization has any members
      // if there are no members, the create as ADMIN
      actionError = {
        code: AuthErrorCode.MEMBER_CREATE_FAILED,
        message: "Member creation failed",
      };
      const members = await retrieveMembersByOrganizationId(
        organization.id,
        tx,
      );
      const role = members.length === 0 ? MemberRole.ADMIN : MemberRole.MEMBER;
      const member = await createMember(user.id, organization.id, role, tx);

      return { organization, user, member };
    });

    // create utm attribution (after main db transaction is committed)
    // without throwing error if it fails
    try {
      const utmData = await getUTMDataFromCookie();
      if (utmData) {
        await createUTMAttribution(result.user.id, utmData, new Date());
      }

      // remove utm cookie (whether it is set or not)
      await removeUTMCookie();
    } catch (error) {
      console.error("Failed to create utm attribution", error);
    }

    return Ok(result);
  } catch (error) {
    console.error("Failed to sign up email", error);

    const parsedBetterAuthApiErrorResult =
      betterAuthApiErrorSchema.safeParse(error);
    if (parsedBetterAuthApiErrorResult.success) {
      switch (parsedBetterAuthApiErrorResult.data.body.code) {
        case AuthErrorCode.USER_ALREADY_EXISTS:
          actionError = {
            code: AuthErrorCode.USER_ALREADY_EXISTS,
            message: "User already exists",
          };
          break;
      }
    }
    return Err(actionError);
  }
}
