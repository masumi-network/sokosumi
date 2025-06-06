"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/auth/utils";
import {
  createMember,
  createOrganization,
  deleteMemberById,
  deleteMemberByUserIdAndOrganizationId,
  getMembersByOrganizationId,
  getMembersWithOrganizationByUserId,
  getMemberWithRelationsById,
  isEmailAllowedByOrganization,
  MemberRole,
  updateMemberRole,
  updateOrganization,
} from "@/lib/db";
import {
  generateOrganizationSlugFromName,
  getMyMemberInOrganization,
} from "@/lib/services";
import { Organization, Prisma } from "@/prisma/generated/client";

import { OrganizationActionErrorCode } from "./error";

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

// used when user sign up
// with organization
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
    const role = members.length === 0 ? MemberRole.ADMIN : MemberRole.MEMBER;
    await createMember(userId, organization.id, role);
    return { success: true };
  } catch (error) {
    console.error("Error creating organization member", error);
    return { success: false };
  }
}

export async function leaveOrganization(
  organizationId: string,
): Promise<{ success: false; error: { code: string } } | { success: true }> {
  try {
    const session = await getSession();
    if (!session) {
      return {
        success: false,
        error: { code: OrganizationActionErrorCode.NOT_AUTHENTICATED },
      };
    }
    const userId = session.user.id;

    // get all members for the user
    const members = await getMembersWithOrganizationByUserId(userId);

    // if user has less than 2 members, cannot leave
    if (members.length <= 1) {
      return {
        success: false,
        error: { code: OrganizationActionErrorCode.MEMBER_COUNT_NOT_ALLOWED },
      };
    }

    // delete member
    await deleteMemberByUserIdAndOrganizationId(userId, organizationId);

    // revalidate the organization page
    revalidatePath(`/app/organizations`);

    return { success: true };
  } catch (error) {
    console.error("Error leaving organization", error);
    return {
      success: false,
      error: { code: OrganizationActionErrorCode.INTERNAL_SERVER_ERROR },
    };
  }
}

export async function updateOrganizationInformation(
  organizationId: string,
  data: Prisma.OrganizationUpdateInput,
): Promise<{ success: false; error: { code: string } } | { success: true }> {
  try {
    const session = await getSession();
    if (!session) {
      return {
        success: false,
        error: { code: OrganizationActionErrorCode.NOT_AUTHENTICATED },
      };
    }

    // check membership and role
    const member = await getMyMemberInOrganization(organizationId);
    if (!member || member.role !== MemberRole.ADMIN) {
      return {
        success: false,
        error: {
          code: OrganizationActionErrorCode.UNAUTHORIZED,
        },
      };
    }

    // update organization information
    const updatedOrganization = await updateOrganization(organizationId, data);

    // revalidate the organization page
    revalidatePath(`/app/organizations/${updatedOrganization.slug}`);
    return { success: true };
  } catch (error) {
    console.error("Error updating organization information", error);
    return {
      success: false,
      error: {
        code: OrganizationActionErrorCode.INTERNAL_SERVER_ERROR,
      },
    };
  }
}

export async function changeMemberRole(
  organizationId: string,
  memberId: string,
  newRole: MemberRole,
): Promise<{ success: false; error: { code: string } } | { success: true }> {
  try {
    const session = await getSession();
    if (!session) {
      return {
        success: false,
        error: { code: OrganizationActionErrorCode.NOT_AUTHENTICATED },
      };
    }

    // check membership and role
    const myMember = await getMyMemberInOrganization(organizationId);
    if (!myMember || myMember.role !== MemberRole.ADMIN) {
      return {
        success: false,
        error: {
          code: OrganizationActionErrorCode.UNAUTHORIZED,
        },
      };
    }

    // check memberId is exists
    // and memberId is not the same as myMember
    const member = await getMemberWithRelationsById(memberId);
    if (!member) {
      return {
        success: false,
        error: { code: OrganizationActionErrorCode.MEMBER_NOT_FOUND },
      };
    }
    if (member.userId === myMember.userId) {
      return {
        success: false,
        error: {
          code: OrganizationActionErrorCode.CHANGE_MY_ROLE_NOT_ALLOWED,
        },
      };
    }

    // check member is in same organization
    if (member.organizationId !== organizationId) {
      return {
        success: false,
        error: { code: OrganizationActionErrorCode.MEMBER_NOT_IN_ORGANIZATION },
      };
    }

    // update member role
    await updateMemberRole(memberId, newRole);

    // revalidate the organization page
    revalidatePath(`/app/organizations/${member.organization.slug}/members`);
    return { success: true };
  } catch (error) {
    console.error("Error updating organization information", error);
    return {
      success: false,
      error: {
        code: OrganizationActionErrorCode.INTERNAL_SERVER_ERROR,
      },
    };
  }
}

export async function kickMember(
  organizationId: string,
  memberId: string,
): Promise<{ success: false; error: { code: string } } | { success: true }> {
  try {
    const session = await getSession();
    if (!session) {
      return {
        success: false,
        error: { code: OrganizationActionErrorCode.NOT_AUTHENTICATED },
      };
    }

    // check membership and role
    const myMember = await getMyMemberInOrganization(organizationId);
    if (!myMember || myMember.role !== MemberRole.ADMIN) {
      return {
        success: false,
        error: {
          code: OrganizationActionErrorCode.UNAUTHORIZED,
        },
      };
    }

    // check memberId is exists
    // and memberId is not the same as myMember
    const member = await getMemberWithRelationsById(memberId);
    if (!member) {
      return {
        success: false,
        error: { code: OrganizationActionErrorCode.MEMBER_NOT_FOUND },
      };
    }
    if (member.userId === myMember.userId) {
      return {
        success: false,
        error: {
          code: OrganizationActionErrorCode.KICK_MYSELF_NOT_ALLOWED,
        },
      };
    }

    // check member is in same organization
    if (member.organizationId !== organizationId) {
      return {
        success: false,
        error: { code: OrganizationActionErrorCode.MEMBER_NOT_IN_ORGANIZATION },
      };
    }

    // kick member
    await deleteMemberById(memberId);

    // revalidate the organization page
    revalidatePath(`/app/organizations/${member.organization.slug}/members`);
    return { success: true };
  } catch (error) {
    console.error("Error kicking member", error);
    return {
      success: false,
      error: {
        code: OrganizationActionErrorCode.INTERNAL_SERVER_ERROR,
      },
    };
  }
}
