"use server";

import z from "zod";

import { auth } from "@/lib/auth/auth";
import { updatePendingInvitationsByEmailAndOrganizationId } from "@/lib/db/invitation/repo";
import { createMember } from "@/lib/db/member/repo";
import {
  createOrganization,
  filterValidEmailDomains,
} from "@/lib/db/organization/repo";
import { MemberRole } from "@/lib/db/organization/types";
import prisma from "@/lib/db/prisma";
import { generateOrganizationSlugFromName } from "@/lib/services/organization/service";
import { getEmailDomain } from "@/lib/utils/email";

export async function signInSocial(
  _provider: "google" | "microsoft" | "apple" | "linkedin",
): Promise<{ success: boolean; error?: string }> {
  try {
    return { success: false };
    //as it is unuesed for now we will just fail
    /*
    await auth.api.signInSocial({
      body: {
        provider: provider,
      },
    });

    return { success: true };*/
  } catch {
    return { success: false };
  }
}

const signUpEmailSchema = z
  .object({
    name: z.string().min(1).max(150),
    organizationName: z.string().min(1).max(150),
    email: z.string().email(),
    password: z.string().min(8).max(150),
    organizationId: z.null(),
    termsAccepted: z.boolean(),
    marketingOptIn: z.boolean(),
    callbackURL: z.string(),
  })
  .or(
    z.object({
      name: z.string().min(1).max(150),
      organizationName: z.null(),
      organizationId: z.string().min(1).max(150),
      email: z.string().email(),
      password: z.string().min(8).max(150),
      termsAccepted: z.boolean(),
      marketingOptIn: z.boolean(),
      callbackURL: z.string(),
    }),
  );

export async function signUpEmail(
  name: string,
  organizationName: string | null,
  email: string,
  password: string,
  organizationId: string | null,
  termsAccepted: boolean,
  marketingOptIn: boolean,
  callbackURL: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const validated = await signUpEmailSchema.safeParseAsync({
      name,
      organizationName,
      organizationId,
      email,
      password,
      termsAccepted,
      marketingOptIn,
      callbackURL,
    });

    if (!validated.success) {
      return {
        success: false,
        error: "Invalid input",
      };
    }

    const result = await prisma.$transaction(async (tx) => {
      if (validated.data.organizationId != null) {
        const organization = await prisma.organization.findUnique({
          where: {
            id: validated.data.organizationId,
          },
        });
        if (!organization) {
          return {
            success: false,
            error: "Organization not found",
          };
        }

        const updatedInvitations =
          await updatePendingInvitationsByEmailAndOrganizationId(
            email,
            organization.id,
            tx,
          );

        const userEmailDomain = getEmailDomain(validated.data.email);
        if (
          updatedInvitations.count === 0 &&
          (!userEmailDomain ||
            !organization.requiredEmailDomains.includes(userEmailDomain))
        ) {
          return {
            success: false,
            error: "EMAIL_NOT_ALLOWED_BY_ORGANIZATION",
          };
        }

        const user = await auth.api.signUpEmail({
          body: {
            email: validated.data.email,
            name: validated.data.name,
            password: validated.data.password,
            callbackURL: validated.data.callbackURL,
            termsAccepted: validated.data.termsAccepted,
            marketingOptIn: validated.data.marketingOptIn,
          },
        });
        //  const user = await authClient.signUp.email(signUpData);
        if (!user.user) {
          return {
            success: false,
            error: "INTERNAL_SERVER_ERROR",
          };
        }
        const member = await createMember(
          user.user.id,
          organization.id,
          MemberRole.MEMBER,
          tx,
        );
        return { organization, member, user: user.user, success: true };
      } else {
        const user = await auth.api.signUpEmail({
          body: {
            email: validated.data.email,
            name: validated.data.name,
            password: validated.data.password,
            callbackURL: validated.data.callbackURL,
            termsAccepted: validated.data.termsAccepted,
          },
        });
        if (!user.user) {
          return {
            success: false,
            error: "INTERNAL_SERVER_ERROR",
          };
        }
        const slug = await generateOrganizationSlugFromName(
          validated.data.organizationName,
        );
        const domainOfEmail = getEmailDomain(email);
        const organizationEmails = filterValidEmailDomains(
          domainOfEmail ? [domainOfEmail] : null,
        );

        const organization = await createOrganization(
          slug,
          name,
          organizationEmails,
          tx,
        );
        if (!organization) {
          throw new Error("Organization not created");
        }
        const member = await createMember(
          user.user.id,
          organization.id,
          MemberRole.ADMIN,
          tx,
        );
        return { organization, member, user, success: true };
      }
    });
    return result;
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      return {
        success: false,
        error: error.message,
      };
    }
    return { success: false, error: "INTERNAL_SERVER_ERROR" };
  }
}
