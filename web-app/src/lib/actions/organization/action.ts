"use server";
//TODO: This needs to be restructured
import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/auth/utils";
import { createMember, getMembersByOrganizationId } from "@/lib/db/member/repo";
import {
  createOrganization,
  updateOrganization,
} from "@/lib/db/organization/repo";
import { MemberRole } from "@/lib/db/organization/types";
import { isEmailAllowedByOrganization } from "@/lib/db/organization/utils";
import {
  generateOrganizationSlugFromName,
  getMyMemberInOrganization,
} from "@/lib/services/organization/service";
import { Organization, Prisma } from "@/prisma/generated/client";

import { OrganizationActionErrorCode } from "./error";

export async function createOrganizationFromName(
  name: string,
  requiredEmailDomains: string[],
) {
  try {
    const slug = await generateOrganizationSlugFromName(name);

    const organization = await createOrganization(
      slug,
      name,
      requiredEmailDomains,
    );
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
// and update all pending invitations
export async function createOrganizationMember(
  userEmail: string,
  organization: Organization,
) {
  try {
    const session = await getSession();
    if (!session) {
      return {
        success: false,
        error: { code: OrganizationActionErrorCode.NOT_AUTHENTICATED },
      };
    }
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
    await createMember(session.user.id, organization.id, role);
    return { success: true };
  } catch (error) {
    console.error("Error creating organization member", error);
    return { success: false };
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

export async function revalidateOrganizationsPath() {
  revalidatePath("/app/organizations");
}
