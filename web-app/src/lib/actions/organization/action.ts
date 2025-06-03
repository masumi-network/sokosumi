"use server";

import { revalidatePath } from "next/cache";

import { EditFormSchemaType as OrganizationInformationEditFormSchemaType } from "@/components/organizations";
import { isUnAuthorizedError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/utils";
import {
  createMember,
  createOrganization,
  deleteMember,
  getMembersByOrganizationId,
  getMembersByUserId,
  isEmailAllowedByOrganization,
  MemberWithOrganization,
  updateOrganization,
} from "@/lib/db";
import {
  findMemberInOrganization,
  generateOrganizationSlugFromName,
} from "@/lib/services";
import { Organization, Role } from "@/prisma/generated/client";

import {
  LeaveOrganizationErrorCodes,
  UpdateOrganizationInformationErrorCodes,
} from "./error";

export async function createOrganizationFromName(name: string) {
  try {
    const slug = await generateOrganizationSlugFromName(name);

    const organization = await createOrganization(name, slug);
    // Revalidate the register page to update the UI
    revalidatePath("/register");
    return { organization, success: true };
  } catch (error) {
    console.error("Error creating organization", error);
    return { organization: null, success: false };
  }
}

export async function createOrganizationMember(
  userId: string,
  userEmail: string,
  organization: Organization,
) {
  try {
    // check user email's domain
    if (!isEmailAllowedByOrganization(userEmail, organization)) {
      return {
        success: false,
        code: "EMAIL_DOMAIN_NOT_ALLOWED_BY_ORGANIZATION",
      };
    }

    // check if organization has any members
    const members = await getMembersByOrganizationId(organization.id);

    // if there are no members, the create as ADMIN
    const role = members.length === 0 ? Role.ADMIN : Role.MEMBER;
    await createMember(userId, organization.id, role);
    return { success: true };
  } catch (error) {
    console.error("Error creating organization member", error);
    return { success: false };
  }
}

export async function listMyMembers(): Promise<
  MemberWithOrganization[] | null
> {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const userId = session.user.id;

  return await getMembersByUserId(userId);
}

export async function leaveOrganization(
  organizationId: string,
): Promise<{ success: false; error: { code: string } } | { success: true }> {
  try {
    const session = await getSession();
    if (!session) {
      return {
        success: false,
        error: { code: LeaveOrganizationErrorCodes.NOT_AUTHENTICATED },
      };
    }
    const userId = session.user.id;

    // get all members for the user
    const members = await getMembersByUserId(userId);

    // if user has less than 2 members, cannot leave
    if (members.length <= 1) {
      return {
        success: false,
        error: { code: LeaveOrganizationErrorCodes.MEMBER_COUNT_NOT_ALLOWED },
      };
    }

    // delete member
    await deleteMember(userId, organizationId);

    // revalidate the organization page
    revalidatePath(`/app/organizations`);

    return { success: true };
  } catch (error) {
    console.error("Error leaving organization", error);
    return {
      success: false,
      error: { code: LeaveOrganizationErrorCodes.INTERNAL_SERVER_ERROR },
    };
  }
}

export async function updateOrganizationInformation(
  organizationId: string,
  data: OrganizationInformationEditFormSchemaType,
): Promise<{ success: false; error: { code: string } } | { success: true }> {
  try {
    // check membership
    const member = await findMemberInOrganization(organizationId);
    if (!member) {
      return {
        success: false,
        error: {
          code: UpdateOrganizationInformationErrorCodes.NOT_MEMBER,
        },
      };
    }

    // check role is ADMIN
    if (member.role !== Role.ADMIN) {
      return {
        success: false,
        error: {
          code: UpdateOrganizationInformationErrorCodes.NOT_ADMIN,
        },
      };
    }

    // update organization information
    const updatedOrganization = await updateOrganization(organizationId, {
      name: data.name,
      metadata: data.metadata === "" ? undefined : data.metadata,
      requiredEmailDomains: data.requiredEmailDomains,
    });

    // revalidate the organization page
    revalidatePath(`/app/organizations/${updatedOrganization.slug}`);
    return { success: true };
  } catch (error) {
    if (isUnAuthorizedError(error)) {
      return {
        success: false,
        error: {
          code: UpdateOrganizationInformationErrorCodes.NOT_AUTHENTICATED,
        },
      };
    }
    console.error("Error updating organization information", error);
    return {
      success: false,
      error: {
        code: UpdateOrganizationInformationErrorCodes.INTERNAL_SERVER_ERROR,
      },
    };
  }
}
