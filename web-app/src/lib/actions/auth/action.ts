"use server";

import { User } from "better-auth";

import { signUpFormSchema, SignUpFormSchemaType } from "@/auth/register/data";
import {
  ActionError,
  AuthErrorCode,
  CommonErrorCode,
} from "@/lib/actions/types";
import { auth } from "@/lib/auth/auth";
import { MemberRole } from "@/lib/db";
import {
  acceptPendingInvitationsByEmailAndOrganizationId,
  createMember,
  createOrganization,
  prisma,
  retrieveMembersByOrganizationId,
  retrieveOrganizationById,
} from "@/lib/db/repositories";
import { generateOrganizationSlugFromName } from "@/lib/services";
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
): Promise<
  Result<
    { organization: Organization; member: Member; user: User },
    ActionError
  >
> {
  try {
    const parsed = await signUpFormSchema().safeParseAsync(data);
    if (!parsed.success) {
      return Err({
        message: "Bad input",
        code: AuthErrorCode.BAD_INPUT,
      });
    }

    let actionError: ActionError = {
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
    };
    let result:
      | {
          organization: Organization;
          user: User;
          member: Member;
        }
      | undefined;
    try {
      await prisma.$transaction(async (tx) => {
        let organization: Organization;
        if ("id" in data.organization) {
          const retrievedOrganization = await retrieveOrganizationById(
            data.organization.id,
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

          // check whether user has invitation or his email domain is allowed by organization
          const updatedInvitations =
            await acceptPendingInvitationsByEmailAndOrganizationId(
              data.email,
              organization.id,
              tx,
            );
          const userEmailDomain = getEmailDomain(data.email);
          if (
            updatedInvitations.count === 0 &&
            (!userEmailDomain ||
              !organization.requiredEmailDomains.includes(userEmailDomain))
          ) {
            actionError = {
              code: AuthErrorCode.EMAIL_NOT_ALLOWED_BY_ORGANIZATION,
              message: "Email not allowed by organization",
            };
            throw new Error("Email not allowed by organization");
          }
        } else {
          const emailDomain = getEmailDomain(data.email);
          const requiredEmailDomains = removePublicDomains([emailDomain]);
          const slug = await generateOrganizationSlugFromName(
            data.organization.name,
          );

          const createdOrganization = await createOrganization(
            slug,
            data.organization.name,
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
        }

        const signUpResult = await auth.api.signUpEmail({
          body: {
            email: data.email,
            name: data.name,
            password: data.password,
            callbackURL: "/app",
            termsAccepted: data.termsAccepted,
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
        const role =
          members.length === 0 ? MemberRole.ADMIN : MemberRole.MEMBER;
        const member = await createMember(user.id, organization.id, role, tx);

        result = { organization, user, member };
      });
    } catch (error) {
      actionError = {
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "Internal server error",
      };
      throw error;
    }

    return result ? Ok(result) : Err(actionError);
  } catch (error) {
    console.error("Failed to sign up email", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}
